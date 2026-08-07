/**
 * Operations day board — "what is happening on the ground on a given date, and
 * is it ready?"
 *
 * This is the data behind `/dashboard/accounts/reports`. It deliberately carries
 * **no money**: no quote, no cost, no profit, no balance. The page it feeds is
 * read on the operations floor, where the only questions are whether a driver is
 * allocated, whether the guest has been reconfirmed, whether tickets are issued
 * and how far QC has got.
 *
 * One query, three views. A booking is *on ground* on date D when
 * `arrivalDate <= D <= departureDate`; the arrivals and departures lists are
 * subsets of that same set, so the whole board comes from a single fetch and the
 * three tabs can never disagree with one another.
 *
 * The checklist itself is `computeReadiness()` — the same rules the booking QC
 * panel and the daily mail use, so the board cannot contradict either.
 *
 * Reconfirmation has two independent signals and the page shows both:
 *   • **Client confirm** — the booking status reached "Client Confirmed"
 *     (`GT_VERIFIED`) or beyond. Comes from the readiness checklist.
 *   • **Pre-tour call** — a row in `tbl_te_reconfirmation`, written by the TE
 *     call agent when the pre-tour reconfirmation call actually happened. That
 *     table belongs to the TE stack and may be absent on some environments, so
 *     the lookup is defensive: a missing table degrades to "no call data"
 *     instead of failing the board.
 */
import { prisma } from '@/lib/prisma'
import { countryLabel, countryScope, type OperationCountry } from '@/lib/country-detection'
import { computeReadiness, type ReadinessCheck, type QcStage } from '@/lib/booking-readiness'
import { STATUS_LABELS } from '@/lib/state-machine'
import {
  DEFAULT_REPORT_TZ, dateInTz, formatReportDate, shiftDate, zonedDayStart,
} from './report-window'
import type { BookingStatus, Prisma } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

/** The outcome of the pre-tour reconfirmation call, when one was logged. */
export interface PreTourCall {
  /** `yyyy-mm-dd` the call row was written. */
  at: string
  /** Upstream outcome word — "completed", "no_answer", … Empty when not set. */
  outcome: string
  sentiment: string
  summary: string
  /** Each answered as "yes" / "no" / null by the call agent. */
  datesOk: string | null
  flightOk: string | null
  paxOk: string | null
  contactOk: string | null
  requestedChange: string | null
}

export interface OpsDayRow {
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  leadPassenger: string | null
  country: string
  countryLabel: string
  destination: string | null
  status: BookingStatus
  statusLabel: string
  arrivalDate: string
  departureDate: string
  pax: number
  paxAdults: number
  paxChildren: number
  paxInfants: number
  /** 1-based day of the tour that the board date falls on. */
  dayNo: number
  totalDays: number
  /** The guest lands on the board date. */
  isArrival: boolean
  /** The guest leaves on the board date. */
  isDeparture: boolean

  driver: ReadinessCheck
  tickets: ReadinessCheck
  qc: ReadinessCheck & { stage: QcStage }
  /** Status has reached "Client Confirmed" or beyond. */
  clientConfirmed: boolean
  /** Null when no reconfirmation call has been logged for this booking. */
  preTourCall: PreTourCall | null
  /** True when driver, tickets, QC2 and both reconfirmation signals are clear. */
  ready: boolean
  outstanding: string[]
}

export interface OpsCountRow {
  key: string
  label: string
  /** Fully done. */
  done: number
  /** Started but not finished — part-allocated drivers, QC1 only. */
  partial: number
  /** Nothing done yet. */
  pending: number
  /** Nothing to do — no transfers, no tickets. */
  na: number
}

export interface OpsDaySummary {
  onGround: number
  arrivals: number
  departures: number
  paxOnGround: number
  paxArriving: number
  paxDeparting: number
  /** Bookings on ground with every check clear. */
  ready: number
  /** Per-check rollup, in the order ops asks the questions. */
  checks: OpsCountRow[]
  /** Head-count of each reconfirmation signal across the on-ground set. */
  reconfirm: { clientConfirmed: number; preTourCalled: number; neither: number }
  byCountry: { country: string; label: string; bookings: number; pax: number }[]
}

export interface OpsDayBoard {
  /** The local date the board describes, `yyyy-mm-dd`. */
  date: string
  /** "Fri 07 Aug 2026". */
  label: string
  timezone: string
  /** True when `date` is today in the operations timezone. */
  isToday: boolean
  /** False when the TE reconfirmation table could not be read. */
  callDataAvailable: boolean
  summary: OpsDaySummary
  rows: OpsDayRow[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** A cancelled tour is not on the ground, whatever its dates say. */
const DEAD_STATUSES: BookingStatus[] = ['CANCELLED']

const MAX_ROWS = 1000

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : ''
}

/** Whole days between two `yyyy-mm-dd` dates, `to - from`. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Roll a check's four states up across every row on the board. */
function countStates(
  rows: OpsDayRow[],
  key: string,
  label: string,
  pick: (r: OpsDayRow) => ReadinessCheck,
): OpsCountRow {
  const out: OpsCountRow = { key, label, done: 0, partial: 0, pending: 0, na: 0 }
  for (const r of rows) {
    const state = pick(r).state
    if (state === 'DONE') out.done += 1
    else if (state === 'PARTIAL') out.partial += 1
    else if (state === 'PENDING') out.pending += 1
    else out.na += 1
  }
  return out
}

// ─── Pre-tour calls ───────────────────────────────────────────────────────────

/**
 * Latest reconfirmation call per booking ref.
 *
 * The table can hold several rows for one booking (a retried call writes a new
 * row per schedule), so rows arrive newest-first and only the first one seen for
 * a ref is kept.
 */
async function loadPreTourCalls(
  refs: string[],
): Promise<{ map: Map<string, PreTourCall>; available: boolean }> {
  const map = new Map<string, PreTourCall>()
  if (!refs.length) return { map, available: true }

  try {
    const rows = await prisma.tbl_te_reconfirmation.findMany({
      where: { booking_ref: { in: refs } },
      orderBy: { created_at: 'desc' },
      select: {
        booking_ref: true, created_at: true, outcome: true, sentiment: true,
        summary: true, dates_ok: true, flight_ok: true, pax_ok: true,
        contact_ok: true, requested_change: true,
      },
    })
    for (const r of rows) {
      if (map.has(r.booking_ref)) continue
      map.set(r.booking_ref, {
        at: isoDate(r.created_at),
        outcome: str(r.outcome),
        sentiment: str(r.sentiment),
        summary: str(r.summary),
        datesOk: r.dates_ok ?? null,
        flightOk: r.flight_ok ?? null,
        paxOk: r.pax_ok ?? null,
        contactOk: r.contact_ok ?? null,
        requestedChange: r.requested_change ?? null,
      })
    }
    return { map, available: true }
  } catch {
    // TE stack not deployed here — the board still works, the call column is
    // simply reported as unavailable rather than silently showing "not called".
    return { map, available: false }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export interface OpsDayOptions {
  /** `yyyy-mm-dd`. Defaults to today in the operations timezone. */
  date?: string | null
  /** A `CountryFilter` value; `ALL` or empty means no country restriction. */
  country?: string | null
  /** Free-text match on booking ref, agent, file handler or passenger name. */
  search?: string | null
  timezone?: string
}

export async function collectOpsDay(opts: OpsDayOptions = {}): Promise<OpsDayBoard> {
  const timezone = opts.timezone || DEFAULT_REPORT_TZ
  const today = dateInTz(new Date(), timezone)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(opts.date ?? '') ? (opts.date as string) : today

  const dayStart = zonedDayStart(date, timezone)
  const dayEnd = zonedDayStart(shiftDate(date, 1), timezone)

  const and: Prisma.BookingWhereInput[] = [
    // On ground on `date`: landed on or before the day ends, leaves on or after
    // it starts. Both bounds are half-open against the local day.
    { arrivalDate: { lt: dayEnd } },
    { departureDate: { gte: dayStart } },
    { status: { notIn: DEAD_STATUSES } },
  ]

  const scope = opts.country && opts.country !== 'ALL'
    ? countryScope(opts.country as OperationCountry)
    : null
  if (scope) and.push({ operationCountry: { in: scope as never[] } })

  const search = str(opts.search)
  if (search) {
    and.push({
      OR: [
        { bookingRef: { contains: search } },
        { agent: { contains: search } },
        { fileHandler: { contains: search } },
        { tourDestination: { contains: search } },
        { passengers: { some: { name: { contains: search } } } },
      ],
    })
  }

  const bookings = await prisma.booking.findMany({
    where: { AND: and },
    orderBy: [{ arrivalDate: 'asc' }, { bookingRef: 'asc' }],
    take: MAX_ROWS,
    select: {
      bookingRef: true, agent: true, fileHandler: true, status: true,
      operationCountry: true, arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, paxInfants: true,
      tourDestination: true, qcPassedAt: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
      tourAgenda: {
        select: {
          items: {
            select: {
              serviceType: true,
              isLeisure: true,
              assignment: { select: { driverId: true, vendorId: true } },
            },
          },
        },
      },
      slDriverAllocation: { select: { driverId: true, vendorId: true } },
      tickets: { select: { activated: true, status: true } },
    },
  })

  const { map: calls, available: callDataAvailable } = await loadPreTourCalls(
    bookings.map(b => b.bookingRef),
  )

  const rows: OpsDayRow[] = bookings.map(b => {
    const readiness = computeReadiness({
      status: b.status,
      qcPassedAt: b.qcPassedAt,
      tourAgenda: b.tourAgenda,
      slDriverAllocation: b.slDriverAllocation,
      tickets: b.tickets,
    })

    const arrivalDate = isoDate(b.arrivalDate)
    const departureDate = isoDate(b.departureDate)
    const preTourCall = calls.get(b.bookingRef) ?? null
    const country = (b.operationCountry as string | null) ?? 'UNASSIGNED'

    // A reconfirmation is outstanding when neither signal is in: the client has
    // not confirmed and no pre-tour call has been logged. Either one on its own
    // is enough for ops to treat the guest as reconfirmed.
    const reconfirmed = readiness.client.state === 'DONE' || !!preTourCall
    const outstanding = [
      reconfirmed ? null : 'reconfirmation',
      ...readiness.outstanding.filter(o => o !== 'client confirmation'),
    ].filter((x): x is string => x !== null)

    return {
      bookingRef: b.bookingRef,
      agent: b.agent,
      fileHandler: b.fileHandler,
      leadPassenger: b.passengers[0]?.name ?? null,
      country,
      countryLabel: country === 'UNASSIGNED' ? 'Others' : countryLabel(country as OperationCountry),
      destination: b.tourDestination,
      status: b.status,
      statusLabel: STATUS_LABELS[b.status] ?? String(b.status),
      arrivalDate,
      departureDate,
      pax: b.paxAdults + b.paxChildren + b.paxInfants,
      paxAdults: b.paxAdults,
      paxChildren: b.paxChildren,
      paxInfants: b.paxInfants,
      dayNo: daysBetween(arrivalDate, date) + 1,
      totalDays: daysBetween(arrivalDate, departureDate) + 1,
      isArrival: arrivalDate === date,
      isDeparture: departureDate === date,
      driver: readiness.driver,
      tickets: readiness.tickets,
      qc: readiness.qc,
      clientConfirmed: readiness.client.state === 'DONE',
      preTourCall,
      ready: outstanding.length === 0,
      outstanding,
    }
  })

  // ── Summary ────────────────────────────────────────────────────────────────
  const arrivals = rows.filter(r => r.isArrival)
  const departures = rows.filter(r => r.isDeparture)

  const countryMap = new Map<string, { country: string; label: string; bookings: number; pax: number }>()
  for (const r of rows) {
    const entry = countryMap.get(r.country)
      ?? { country: r.country, label: r.countryLabel, bookings: 0, pax: 0 }
    entry.bookings += 1
    entry.pax += r.pax
    countryMap.set(r.country, entry)
  }

  const summary: OpsDaySummary = {
    onGround: rows.length,
    arrivals: arrivals.length,
    departures: departures.length,
    paxOnGround: rows.reduce((s, r) => s + r.pax, 0),
    paxArriving: arrivals.reduce((s, r) => s + r.pax, 0),
    paxDeparting: departures.reduce((s, r) => s + r.pax, 0),
    ready: rows.filter(r => r.ready).length,
    checks: [
      countStates(rows, 'driver', 'Driver allocation', r => r.driver),
      countStates(rows, 'tickets', 'Tickets issued', r => r.tickets),
      countStates(rows, 'qc', 'QC1 / QC2', r => r.qc),
    ],
    reconfirm: {
      clientConfirmed: rows.filter(r => r.clientConfirmed).length,
      preTourCalled: rows.filter(r => !!r.preTourCall).length,
      neither: rows.filter(r => !r.clientConfirmed && !r.preTourCall).length,
    },
    byCountry: Array.from(countryMap.values())
      .sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label)),
  }

  return {
    date,
    label: formatReportDate(date, { weekday: true }),
    timezone,
    isToday: date === today,
    callDataAvailable,
    summary,
    rows,
  }
}
