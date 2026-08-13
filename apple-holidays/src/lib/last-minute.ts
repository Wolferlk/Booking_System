/**
 * Last-minute bookings — the database side of the D-4 alert.
 *
 * The rules (what "last minute" means, which tier it lands in, when a booking is
 * still worth interrupting the team about) live in `last-minute-shared.ts` and
 * are re-exported here, so server code has one import to reach for and the
 * browser can still take the pure half without dragging Prisma into the client
 * bundle.
 *
 * Two things this module is careful about:
 *
 *  • **The candidate query never scans the book.** "Last minute" compares two
 *    columns, which no `where` clause can express — but it does not have to. A
 *    booking that is still alertable has an arrival today or later *and*, by the
 *    definition itself, was created no earlier than four days before that
 *    arrival. So the widest possible candidate set is
 *    `arrivalDate ≥ today AND createdAt ≥ today − 4 days`, both indexed and both
 *    tiny, and the exact rule is then applied in memory. No raw SQL, no table
 *    scan, and country scoping stays in Prisma where the rest of the system
 *    keeps it.
 *
 *  • **Reads are defensive.** `booking_last_minute_acks` is a new table applied
 *    by hand against a live database that carries schema drift (see
 *    `prisma/sql/2026-08-13-last-minute-acks.sql`), so an environment that has
 *    not had the SQL run yet must degrade to "nothing acknowledged yet" rather
 *    than take the whole dashboard header down. Writes are *not* swallowed: an
 *    operator who acknowledges an alert is told if it did not save, because a
 *    silent failure there means the alarm stops and the reason is gone.
 */

import { prisma } from '@/lib/prisma'
import { canSeeAllCountries } from '@/lib/rbac'
import { userCountryScope } from '@/lib/country-detection'
import { DEFAULT_REPORT_TZ, dateInTz } from '@/lib/reports/report-window'
import {
  LAST_MINUTE_DAYS, arrivalDateKey, classifyLastMinute, daysBetweenKeys, lastMinuteSummary,
  type LastMinuteStanding, type LastMinuteTier,
} from './last-minute-shared'
import type { Prisma, UserRole } from '@prisma/client'
import type { OperationCountry } from '@/lib/country-detection'

export * from './last-minute-shared'

/** Free text on an acknowledgement is capped so one operator cannot bloat a report row. */
const MAX_NOTE = 600

/**
 * Most alerts returned in one poll.
 *
 * A cap exists so a bulk import or a backlog cannot hand the browser an
 * unbounded list; it is set far above any real day's late bookings, so in
 * practice the list is always complete and `truncated` is always false.
 */
const MAX_ALERTS = 50

const DAY_MS = 86_400_000

/** The timezone the operation counts days in — the same one the reports use. */
export const LAST_MINUTE_TZ = DEFAULT_REPORT_TZ

/** One late booking, as the header alert and the API present it. */
export interface LastMinuteAlert {
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  leadName: string | null
  status: string
  operationCountry: string | null
  /** ISO. */
  arrivalDate: string
  /** ISO. */
  departureDate: string
  /** ISO — when the booking was created, i.e. when it was sold. */
  createdAt: string
  createdByName: string | null
  paxAdults: number
  paxChildren: number
  paxInfants: number
  /** Whole days from creation to arrival. */
  leadDays: number
  /** Days from today to arrival; 0 means the guest lands today. */
  daysToArrival: number
  tier: LastMinuteTier
  /** The one-line summary every screen prints — see `lastMinuteSummary()`. */
  summary: string
}

export interface LastMinuteAck {
  bookingRef: string
  acknowledgedAt: string
  acknowledgedBy: string | null
  note: string | null
}

export interface LastMinuteFeed {
  /** Unacknowledged, still-actionable late bookings, nearest arrival first. */
  alerts: LastMinuteAlert[]
  /** True if the cap was hit — see `MAX_ALERTS`. Effectively never. */
  truncated: boolean
  /** False when the acknowledgement table could not be read; see the header note. */
  acksReadable: boolean
  /** `yyyy-mm-dd` the server counted days against, so the client can say so. */
  today: string
}

export interface LastMinuteViewer {
  role: UserRole
  country?: string | null
  countries?: string[] | null
}

// ─── Acknowledgements ─────────────────────────────────────────────────────────

type AckRow = {
  bookingRef: string
  arrivalDate: Date
  acknowledgedAt: Date
  acknowledgedBy: string | null
  note: string | null
}

/**
 * Acknowledgements for the given refs, keyed by ref.
 *
 * Returns `null` — not an empty map — when the table cannot be read, so callers
 * can tell "nobody has acknowledged anything" apart from "we could not ask".
 * The difference matters: the first should keep alarming, the second should not
 * pretend the whole book is unacknowledged.
 */
async function readAcks(refs: string[]): Promise<Map<string, AckRow> | null> {
  if (refs.length === 0) return new Map()
  try {
    const rows = await prisma.bookingLastMinuteAck.findMany({
      where: { bookingRef: { in: refs } },
      select: {
        bookingRef: true, arrivalDate: true,
        acknowledgedAt: true, acknowledgedBy: true, note: true,
      },
    })
    return new Map(rows.map(r => [r.bookingRef, r]))
  } catch (err) {
    console.error('[last-minute] acknowledgement table unreadable (non-fatal):', err)
    return null
  }
}

/**
 * Does this acknowledgement still cover the booking as it stands today?
 *
 * An amendment that pulls the guest **forward** invalidates it: a file someone
 * accepted as "arrives Friday" is a different job once it becomes "arrives
 * tomorrow", and the team is entitled to be told again. Pushing the arrival
 * later never re-raises — that only ever makes the file easier.
 */
function ackStillCovers(ack: AckRow, currentArrival: Date): boolean {
  const acked   = arrivalDateKey(ack.arrivalDate)
  const current = arrivalDateKey(currentArrival)
  return daysBetweenKeys(acked, current) >= 0
}

// ─── The feed ─────────────────────────────────────────────────────────────────

/**
 * Every last-minute booking the viewer is allowed to see that nobody has
 * acknowledged yet, nearest arrival first.
 *
 * Country scoping is applied exactly as the bookings list applies it, so a
 * Vietnam desk is never alarmed about a Sri Lanka file it cannot open. `CLIENT`
 * gets nothing at all — this is an internal operations alarm.
 */
export async function listLastMinuteAlerts(viewer: LastMinuteViewer): Promise<LastMinuteFeed> {
  const today = dateInTz(new Date(), LAST_MINUTE_TZ)
  const empty: LastMinuteFeed = { alerts: [], truncated: false, acksReadable: true, today }

  if (viewer.role === 'CLIENT') return empty

  // Widest candidate window that can possibly contain an alertable booking — see
  // the note at the top of this file. Both bounds are indexed columns.
  //
  // The floor carries one spare day on purpose. `arrivalDate` is a plain
  // calendar date stored at midnight UTC, but `createdAt` is a real instant, and
  // the operations zone is ahead of UTC — so a booking created early on a local
  // morning sits a few hours *before* the naive UTC boundary. A day of slack
  // costs nothing (the exact rule below still decides) and removes the class of
  // bug where the first booking of the day is silently missed.
  const todayStart = new Date(`${today}T00:00:00.000Z`)
  const createdFloor = new Date(todayStart.getTime() - (LAST_MINUTE_DAYS + 1) * DAY_MS)

  const where: Prisma.BookingWhereInput = {
    arrivalDate: { gte: todayStart },
    createdAt: { gte: createdFloor },
    status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION'] },
  }

  if (!canSeeAllCountries(viewer.role, viewer.country as OperationCountry)) {
    const scope = userCountryScope(viewer.country, viewer.countries)
    if (scope) where.operationCountry = { in: scope }
  }

  const candidates = await prisma.booking.findMany({
    where,
    orderBy: { arrivalDate: 'asc' },
    take: MAX_ALERTS * 4,   // headroom: some candidates fail the exact rule below
    select: {
      bookingRef: true, agent: true, fileHandler: true, status: true,
      operationCountry: true, arrivalDate: true, departureDate: true, createdAt: true,
      paxAdults: true, paxChildren: true, paxInfants: true,
      createdBy: { select: { name: true } },
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
    },
  })

  // Apply the exact D-4 rule. This is where back-entered records fall out.
  const late = candidates
    .map(b => ({ booking: b, standing: classifyLastMinute({
      createdAt: b.createdAt,
      arrivalDate: b.arrivalDate,
      today,
      status: b.status,
      timeZone: LAST_MINUTE_TZ,
    }) }))
    .filter(x => x.standing.alertable)

  const acks = await readAcks(late.map(x => x.booking.bookingRef))

  const unacked = late.filter(({ booking }) => {
    if (!acks) return true   // table unreadable — better a repeated alarm than a missed file
    const ack = acks.get(booking.bookingRef)
    return !ack || !ackStillCovers(ack, booking.arrivalDate)
  })

  const alerts = unacked.slice(0, MAX_ALERTS).map(({ booking, standing }) => toAlert(booking, standing))

  return {
    alerts,
    truncated: unacked.length > MAX_ALERTS,
    acksReadable: acks !== null,
    today,
  }
}

type CandidateBooking = {
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  status: string
  operationCountry: string | null
  arrivalDate: Date
  departureDate: Date
  createdAt: Date
  paxAdults: number
  paxChildren: number
  paxInfants: number
  createdBy: { name: string | null } | null
  passengers: { name: string }[]
}

function toAlert(b: CandidateBooking, standing: LastMinuteStanding): LastMinuteAlert {
  return {
    bookingRef: b.bookingRef,
    agent: b.agent,
    fileHandler: b.fileHandler,
    leadName: b.passengers[0]?.name ?? null,
    status: b.status,
    operationCountry: b.operationCountry,
    arrivalDate: b.arrivalDate.toISOString(),
    departureDate: b.departureDate.toISOString(),
    createdAt: b.createdAt.toISOString(),
    createdByName: b.createdBy?.name ?? null,
    paxAdults: b.paxAdults,
    paxChildren: b.paxChildren,
    paxInfants: b.paxInfants,
    leadDays: standing.leadDays,
    daysToArrival: standing.daysToArrival,
    tier: standing.tier ?? 'TIGHT',
    summary: lastMinuteSummary(standing),
  }
}

// ─── Acknowledging ────────────────────────────────────────────────────────────

export interface AcknowledgeActor {
  name?: string | null
  email?: string | null
}

/**
 * Record that the team has seen these late bookings.
 *
 * Idempotent per ref (upsert), and errors are **not** swallowed — if the write
 * fails the caller must be able to tell the operator, because a popup that
 * closes on a failed save is worse than one that refuses to close.
 *
 * Refs the viewer cannot see are filtered out before writing, so acknowledging
 * cannot be used to silence another country's desk.
 */
export async function acknowledgeLastMinute(
  refs: string[],
  actor: AcknowledgeActor,
  viewer: LastMinuteViewer,
  note?: string | null,
): Promise<{ acknowledged: string[] }> {
  if (viewer.role === 'CLIENT') return { acknowledged: [] }

  const wanted = Array.from(new Set(refs.map(r => String(r ?? '').trim()).filter(Boolean)))
  if (wanted.length === 0) return { acknowledged: [] }

  const visible = await listLastMinuteAlerts(viewer)
  const byRef = new Map(visible.alerts.map(a => [a.bookingRef, a]))
  const targets = wanted.map(r => byRef.get(r)).filter((a): a is LastMinuteAlert => Boolean(a))
  if (targets.length === 0) return { acknowledged: [] }

  const trimmed = note?.trim().slice(0, MAX_NOTE) || null

  for (const target of targets) {
    const data = {
      arrivalDate: new Date(target.arrivalDate),
      leadDays: target.leadDays,
      acknowledgedBy: actor.name ?? null,
      acknowledgedByEmail: actor.email ?? null,
      acknowledgedAt: new Date(),
      note: trimmed,
    }
    await prisma.bookingLastMinuteAck.upsert({
      where: { bookingRef: target.bookingRef },
      update: data,
      create: { bookingRef: target.bookingRef, ...data },
    })
  }

  return { acknowledged: targets.map(t => t.bookingRef) }
}

/**
 * The acknowledgement on one booking, for the booking page's chip.
 *
 * Defensive like the feed: an unreadable table reads as "not acknowledged",
 * which shows the chip as outstanding rather than breaking the page.
 */
export async function getLastMinuteAck(bookingRef: string): Promise<LastMinuteAck | null> {
  const acks = await readAcks([bookingRef])
  const row = acks?.get(bookingRef)
  if (!row) return null
  return {
    bookingRef: row.bookingRef,
    acknowledgedAt: row.acknowledgedAt.toISOString(),
    acknowledgedBy: row.acknowledgedBy,
    note: row.note,
  }
}
