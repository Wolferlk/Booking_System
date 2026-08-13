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
 * Reconfirmation has three independent signals and the page shows all three:
 *   • **Client confirm** — the booking status reached "Client Confirmed"
 *     (`GT_VERIFIED`) or beyond. Comes from the readiness checklist.
 *   • **Pre-tour call** — a row in `tbl_te_reconfirmation`, written by the TE
 *     call agent when the pre-tour reconfirmation call actually happened. That
 *     table belongs to the TE stack and may be absent on some environments, so
 *     the lookup is defensive: a missing table degrades to "no call data"
 *     instead of failing the board.
 *   • **WhatsApp call request** — the customer has to accept a WhatsApp message
 *     before the bot may place an automated call at all. Without it the call
 *     above can never happen, so ops needs to see the two apart: a booking
 *     stuck on permission is a different job from one waiting on a dial.
 *     Resolved from the approval ledger (`te_call_approvals`) plus evidence
 *     from the call schedule, and equally defensive.
 *
 * Everything here is read-only. The board derives, it never writes.
 */
import { prisma } from '@/lib/prisma'
import { countryLabel, countryScope, type OperationCountry } from '@/lib/country-detection'
import { computeReadiness, type ReadinessCheck, type QcStage } from '@/lib/booking-readiness'
import { STATUS_LABELS } from '@/lib/state-machine'
import { getApprovalLedger, resolveApprovalState, type ApprovalEntry } from '@/lib/te/call-approvals'
import { normalizePhone } from '@/lib/te/te-api'
import { countFacets, type CallApprovalState, type ReconfirmFacet } from './reconfirm-filters'
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

/**
 * Where the automated reconfirmation call stands for one booking — permission
 * first, then the dial.
 *
 * The bot cannot call a number the customer has not approved over WhatsApp, so
 * `approval` is the gate and `scheduleStatus` is what happens behind it. When
 * the TE stack is not reachable every field degrades to its neutral value and
 * `approval` becomes `unknown`, which no filter treats as a refusal.
 */
export interface ReconfirmCallInfo {
  /** The booking is registered with the AI call service. */
  registered: boolean
  /** Digits-only number the bot dials, when one is on file. */
  phone: string | null
  approval: CallApprovalState
  /** ISO timestamp the WhatsApp request was last sent from ops. */
  approvalRequestedAt: string | null
  /** ISO timestamp the customer accepted. */
  approvedAt: string | null
  /** When the pre-tour call is (or was) due — ISO, null when none is scheduled. */
  scheduledAt: string | null
  /** Raw upstream schedule status: `pending`, `done`, `missed`, … */
  scheduleStatus: string | null
  attempts: number
  /** A reconfirmation call ran and was written up. */
  completed: boolean
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
  /** WhatsApp permission and the pre-tour call schedule behind it. */
  call: ReconfirmCallInfo
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
  /** How many rows each filter chip would keep — the chip badges read this. */
  facets: Record<ReconfirmFacet, number>
  /** WhatsApp approval split, including the rows we cannot speak for. */
  callApproval: Record<CallApprovalState, number>
  byCountry: { country: string; label: string; bookings: number; pax: number }[]
}

export interface OpsDayBoard {
  /** First local date of the window, `yyyy-mm-dd`. Equals `to` for a single day. */
  from: string
  /** Last local date of the window, inclusive. */
  to: string
  /** Back-compat alias for `from` — the board's anchor date. */
  date: string
  /** Whole days in the window, inclusive of both ends. */
  days: number
  /** "Fri 07 Aug 2026", or "01 Aug 2026 → 07 Aug 2026" for a range. */
  label: string
  timezone: string
  /** True when the window is exactly today in the operations timezone. */
  isToday: boolean
  /** False when the TE reconfirmation table could not be read. */
  callDataAvailable: boolean
  /** False when the WhatsApp approval ledger could not be read. */
  approvalDataAvailable: boolean
  summary: OpsDaySummary
  rows: OpsDayRow[]
  /** True when the row cap was hit and the window is showing a partial picture. */
  truncated: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** A cancelled tour is not on the ground, whatever its dates say. */
const DEAD_STATUSES: BookingStatus[] = ['CANCELLED']

const MAX_ROWS = 2000

/**
 * The widest window the board will build. A quarter covers every drill-down ops
 * actually asks for ("this month", "next 30 days") while keeping one query
 * bounded — an unbounded range would happily try to load the whole book.
 */
const MAX_WINDOW_DAYS = 92

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

// ─── WhatsApp call requests ───────────────────────────────────────────────────

/** Schedule statuses that mean the call actually connected. */
const CONNECTED_STATUSES = new Set(['answered', 'done', 'completed'])

/** Upstream spells the pre-tour phase three ways; all of them mean the same row. */
const PRE_TOUR_PHASES = new Set(['reconfirm', 'reconfirmation', 'pre_tour', 'pretour'])

function isoStamp(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

const NO_CALL: ReconfirmCallInfo = {
  registered: false, phone: null, approval: 'unknown',
  approvalRequestedAt: null, approvedAt: null,
  scheduledAt: null, scheduleStatus: null, attempts: 0, completed: false,
}

/**
 * Resolve, per booking, whether the customer has accepted automated WhatsApp
 * calls and where the pre-tour call sits on the schedule.
 *
 * Three reads, each optional:
 *   • `tbl_te_service`       — the number the bot dials, and that the booking is
 *                              registered for calls at all;
 *   • `tbl_te_call_schedule` — the pre-tour row: due date, status, attempts;
 *   • the approval ledger    — `SystemSetting.te_call_approvals`, keyed by phone.
 *
 * A connected call is itself proof of approval — the bot could not have placed
 * it otherwise — so it overrides a ledger that never saw the request, which is
 * what happens when approval was sent from outside the dashboard.
 *
 * `available` is false only when the ledger read failed. Everything else can be
 * missing without making the answer a lie: no service row simply means the
 * booking was never registered for calls.
 */
async function loadCallState(
  refs: string[],
  calledRefs: Set<string>,
): Promise<{ map: Map<string, ReconfirmCallInfo>; available: boolean }> {
  const map = new Map<string, ReconfirmCallInfo>()
  if (!refs.length) return { map, available: true }

  const [services, schedules, ledger] = await Promise.all([
    prisma.tbl_te_service
      .findMany({
        where: { booking_ref: { in: refs } },
        select: { booking_ref: true, call_phone: true, customer_phone: true, status: true },
      })
      .catch(() => null),
    prisma.tbl_te_call_schedule
      .findMany({
        where: { booking_ref: { in: refs } },
        orderBy: { call_date: 'desc' },
        select: {
          booking_ref: true, phase: true, status: true, attempts: true,
          scheduled_at: true, call_date: true, conversation_id: true,
        },
      })
      .catch(() => null),
    getApprovalLedger().catch(() => null),
  ])

  // Index the ledger both ways. Phone is the real key, but an entry written
  // against a booking whose number has since changed still tells us the request
  // went out, so the ref is kept as a fallback rather than thrown away.
  const byPhone = new Map<string, ApprovalEntry>()
  const byRef = new Map<string, ApprovalEntry>()
  for (const [key, entry] of Object.entries(ledger ?? {})) {
    byPhone.set(key, entry)
    const ref = entry.bookingRef?.toUpperCase()
    if (ref && !byRef.has(ref)) byRef.set(ref, entry)
  }

  const serviceByRef = new Map(services?.map(s => [s.booking_ref, s]) ?? [])

  /** Latest pre-tour row per booking, plus whether any call ever connected. */
  const preTourByRef = new Map<string, (NonNullable<typeof schedules>)[number]>()
  const connectedRefs = new Set<string>()
  for (const s of schedules ?? []) {
    if (CONNECTED_STATUSES.has((s.status ?? '').toLowerCase()) || s.conversation_id) {
      connectedRefs.add(s.booking_ref)
    }
    if (!PRE_TOUR_PHASES.has((s.phase ?? '').toLowerCase())) continue
    if (!preTourByRef.has(s.booking_ref)) preTourByRef.set(s.booking_ref, s)
  }

  for (const ref of refs) {
    const service = serviceByRef.get(ref)
    const phone = normalizePhone(service?.call_phone ?? service?.customer_phone) || null
    const schedule = preTourByRef.get(ref)
    // A written-up reconfirmation is the strongest proof of all: the call ran.
    const connected = connectedRefs.has(ref) || calledRefs.has(ref)
    const entry = (phone ? byPhone.get(phone) : undefined) ?? byRef.get(ref)

    map.set(ref, {
      registered: !!service,
      phone,
      approval: ledger === null ? 'unknown' : resolveApprovalState(entry, connected),
      approvalRequestedAt: entry?.requestedAt ?? null,
      approvedAt: entry?.approvedAt ?? null,
      scheduledAt: isoStamp(schedule?.scheduled_at) || isoDate(schedule?.call_date) || null,
      scheduleStatus: schedule?.status ?? null,
      attempts: schedule?.attempts ?? 0,
      completed: calledRefs.has(ref)
        || CONNECTED_STATUSES.has((schedule?.status ?? '').toLowerCase()),
    })
  }

  return { map, available: ledger !== null }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export interface OpsDayOptions {
  /** Single-day shorthand: sets both ends of the window. `yyyy-mm-dd`. */
  date?: string | null
  /** First day of the window, inclusive. Falls back to `date`, then today. */
  from?: string | null
  /** Last day of the window, inclusive. Falls back to `from`. */
  to?: string | null
  /** A `CountryFilter` value; `ALL` or empty means no country restriction. */
  country?: string | null
  /** Free-text match on booking ref, agent, file handler or passenger name. */
  search?: string | null
  timezone?: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A valid `yyyy-mm-dd` from the input, or null. */
function asDate(v: string | null | undefined): string | null {
  return v && ISO_DATE.test(v) ? v : null
}

export async function collectOpsDay(opts: OpsDayOptions = {}): Promise<OpsDayBoard> {
  const timezone = opts.timezone || DEFAULT_REPORT_TZ
  const today = dateInTz(new Date(), timezone)

  // Resolve the window. Callers may pass a single `date`, a `from`/`to` pair, or
  // nothing at all; a reversed pair is swapped rather than rejected, since a
  // date picker makes that easy to do by accident.
  const anchor = asDate(opts.from) ?? asDate(opts.date) ?? today
  const other = asDate(opts.to) ?? asDate(opts.date) ?? anchor
  const from = anchor <= other ? anchor : other
  let to = anchor <= other ? other : anchor

  if (daysBetween(from, to) + 1 > MAX_WINDOW_DAYS) {
    to = shiftDate(from, MAX_WINDOW_DAYS - 1)
  }

  const dayStart = zonedDayStart(from, timezone)
  const dayEnd = zonedDayStart(shiftDate(to, 1), timezone)

  const and: Prisma.BookingWhereInput[] = [
    // On ground during the window: landed before the window ends, leaves on or
    // after it starts. Both bounds are half-open against the local days.
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
              isHotelOnly: true,
              assignment: { select: { driverId: true, vendorId: true } },
            },
          },
        },
      },
      slDriverAllocation: { select: { driverId: true, vendorId: true, vehicleType: true } },
      tickets: { select: { activated: true, status: true } },
    },
  })

  const refs = bookings.map(b => b.bookingRef)
  const { map: calls, available: callDataAvailable } = await loadPreTourCalls(refs)
  // Needs the logged calls first: a written-up reconfirmation proves the number
  // was approved, whatever the ledger has to say.
  const { map: callState, available: approvalDataAvailable } = await loadCallState(
    refs, new Set(calls.keys()),
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
      // Day-of-tour is measured against the start of the window; a tour that
      // began before it opened is clamped to day 1 rather than going negative.
      dayNo: Math.max(1, daysBetween(arrivalDate, from) + 1),
      totalDays: daysBetween(arrivalDate, departureDate) + 1,
      isArrival: arrivalDate >= from && arrivalDate <= to,
      isDeparture: departureDate >= from && departureDate <= to,
      driver: readiness.driver,
      tickets: readiness.tickets,
      qc: readiness.qc,
      clientConfirmed: readiness.client.state === 'DONE',
      preTourCall,
      call: callState.get(b.bookingRef) ?? NO_CALL,
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
    facets: countFacets(rows),
    callApproval: rows.reduce((acc, r) => {
      acc[r.call.approval] += 1
      return acc
    }, { approved: 0, pending: 0, not_requested: 0, unknown: 0 } as Record<CallApprovalState, number>),
    byCountry: Array.from(countryMap.values())
      .sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label)),
  }

  const days = daysBetween(from, to) + 1

  return {
    from,
    to,
    date: from,
    days,
    label: days === 1
      ? formatReportDate(from, { weekday: true })
      : `${formatReportDate(from)} → ${formatReportDate(to)}`,
    timezone,
    isToday: from === today && to === today,
    callDataAvailable,
    approvalDataAvailable,
    summary,
    rows,
    truncated: bookings.length >= MAX_ROWS,
  }
}
