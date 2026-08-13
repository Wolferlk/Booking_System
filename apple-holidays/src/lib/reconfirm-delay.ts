/**
 * Guest reconfirmation delay reasons — the database side.
 *
 * The rules (what D-10 means, when a reason is owed, when one goes stale) are in
 * `reconfirm-delay-shared.ts` and are re-exported here, so server code has one
 * import to reach for and the browser can still take the pure half without
 * dragging Prisma into the client bundle.
 *
 * Every read here is **defensive**. `booking_reconfirm_delays` is a new table
 * applied by hand against a live database that carries schema drift (see
 * `prisma/sql/2026-08-13-reconfirm-delay.sql`), so an environment that has not
 * had the SQL run yet must degrade to "no reasons recorded" rather than take the
 * operations board and the morning mail down with it. Writes are not swallowed:
 * an operator who types an explanation is told if it did not save.
 */
import { prisma } from '@/lib/prisma'
import { computeReadiness } from '@/lib/booking-readiness'
import { DEFAULT_REPORT_TZ, dateInTz } from '@/lib/reports/report-window'
import {
  REASON_STALE_DAYS, classifyReconfirm, isReconfirmReason, reasonLabel,
  type ReconfirmDelay, type ReconfirmDelayReason, type ReconfirmStanding,
} from './reconfirm-delay-shared'

export * from './reconfirm-delay-shared'

const DAY_MS = 86_400_000

/** Free text is capped so one operator cannot bloat every report row. */
const MAX_NOTE = 600

type Row = {
  bookingRef: string
  reason: string
  note: string | null
  recordedBy: string | null
  recordedAt: Date
}

/**
 * Shape a stored row for the UI, ageing it against `now`.
 *
 * `stale` is computed on read rather than stored: an explanation does not
 * change, but how old it is does, and a flag written at save time would be a lie
 * by the following week.
 */
function toDelay(row: Row, now: Date): ReconfirmDelay {
  const ageDays = Math.max(0, Math.floor((now.getTime() - row.recordedAt.getTime()) / DAY_MS))
  return {
    bookingRef: row.bookingRef,
    // An unrecognised code (hand-written SQL, a reason we later retired) is kept
    // rather than dropped — the desk's words are more use than a blank cell.
    reason: (isReconfirmReason(row.reason) ? row.reason : 'OTHER') as ReconfirmDelayReason,
    reasonLabel: reasonLabel(row.reason),
    note: row.note?.trim() || null,
    recordedAt: row.recordedAt.toISOString(),
    recordedBy: row.recordedBy,
    ageDays,
    stale: ageDays >= REASON_STALE_DAYS,
  }
}

/**
 * Recorded reasons for a set of bookings, keyed by ref.
 *
 * One query for the whole board — the ops day view and the daily mail both hold
 * hundreds of refs, and a per-row lookup would be the slowest thing on either
 * page. An empty map is returned when the table is missing, which reads
 * downstream as "nobody has explained these", the correct answer either way.
 */
export async function loadReconfirmDelays(
  refs: string[],
  now: Date = new Date(),
): Promise<Map<string, ReconfirmDelay>> {
  const map = new Map<string, ReconfirmDelay>()
  if (!refs.length) return map

  try {
    const rows = await prisma.bookingReconfirmDelay.findMany({
      where: { bookingRef: { in: refs } },
      select: { bookingRef: true, reason: true, note: true, recordedBy: true, recordedAt: true },
    })
    for (const r of rows) map.set(r.bookingRef, toDelay(r, now))
  } catch {
    // Table not deployed on this environment — the board still works, it simply
    // reports every breach as unexplained.
  }
  return map
}

/** The one recorded reason for a booking, or null. */
export async function getReconfirmDelay(
  bookingRef: string,
  now: Date = new Date(),
): Promise<ReconfirmDelay | null> {
  try {
    const row = await prisma.bookingReconfirmDelay.findUnique({
      where: { bookingRef },
      select: { bookingRef: true, reason: true, note: true, recordedBy: true, recordedAt: true },
    })
    return row ? toDelay(row, now) : null
  } catch {
    return null
  }
}

export interface SaveReconfirmDelayInput {
  bookingRef: string
  reason: ReconfirmDelayReason
  note?: string | null
  /** The D-10 date the explanation is being written against. */
  dueAt?: Date | null
  actor: string
}

/**
 * Write (or overwrite) a booking's explanation.
 *
 * There is one row per booking and it is replaced in place rather than appended
 * to: the board and the mail want the *current* answer, and a history of
 * superseded excuses would be read by nobody. The trail that matters — who said
 * what, when — is written to `StatusEvent` by the API route, alongside every
 * other decision taken on the file.
 *
 * `recordedAt` is bumped on every save, which is what makes the staleness flag
 * meaningful: re-affirming an unchanged reason is itself the update.
 */
export async function saveReconfirmDelay(input: SaveReconfirmDelayInput): Promise<ReconfirmDelay> {
  const now = new Date()
  const note = input.note?.trim().slice(0, MAX_NOTE) || null
  const data = {
    reason: input.reason,
    note,
    dueAt: input.dueAt ?? null,
    recordedBy: input.actor,
    recordedAt: now,
  }

  const row = await prisma.bookingReconfirmDelay.upsert({
    where: { bookingRef: input.bookingRef },
    create: { bookingRef: input.bookingRef, ...data },
    update: data,
    select: { bookingRef: true, reason: true, note: true, recordedBy: true, recordedAt: true },
  })
  return toDelay(row, now)
}

/** Remove a booking's explanation. Returns false when there was none to remove. */
export async function clearReconfirmDelay(bookingRef: string): Promise<boolean> {
  const { count } = await prisma.bookingReconfirmDelay.deleteMany({ where: { bookingRef } })
  return count > 0
}

// ─── One booking's whole picture ──────────────────────────────────────────────

export interface BookingReconfirmView {
  bookingRef: string
  arrivalDate: string
  standing: ReconfirmStanding
  /** Booking status has reached "Client Confirmed" or beyond. */
  clientConfirmed: boolean
  /** `yyyy-mm-dd` a TE pre-tour call was logged, when one was. */
  preTourCalledAt: string | null
  delay: ReconfirmDelay | null
  /** Operations-local date the standing was computed against. */
  today: string
  timezone: string
}

/**
 * The booking detail page's answer to "where does this file stand on
 * reconfirmation, and has anyone explained it?".
 *
 * Both reconfirmation signals are resolved the same way the operations board
 * resolves them, so the panel on the booking and the cell on the board can never
 * disagree — which matters, because the panel is where the disagreement would be
 * argued with.
 */
export async function loadBookingReconfirm(
  bookingRef: string,
  timezone: string = DEFAULT_REPORT_TZ,
): Promise<BookingReconfirmView | null> {
  const now = new Date()
  const today = dateInTz(now, timezone)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { bookingRef: true, status: true, arrivalDate: true, hotelOnly: true },
  })
  if (!booking) return null

  // The TE stack is not deployed everywhere, and its absence must not be read as
  // "no call was made" any more loudly than it already is: a failed lookup
  // degrades to null, exactly like a booking that genuinely has no call.
  const call = await prisma.tbl_te_reconfirmation
    .findFirst({
      where: { booking_ref: bookingRef },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    })
    .catch(() => null)

  const arrivalDate = booking.arrivalDate.toISOString().slice(0, 10)
  const clientConfirmed =
    computeReadiness({ status: booking.status, hotelOnly: booking.hotelOnly }).client.state === 'DONE'

  return {
    bookingRef: booking.bookingRef,
    arrivalDate,
    standing: classifyReconfirm({
      arrivalDate,
      today,
      clientConfirmed,
      preTourCalled: !!call,
      hotelOnly: booking.hotelOnly,
    }),
    clientConfirmed,
    preTourCalledAt: call ? call.created_at.toISOString().slice(0, 10) : null,
    delay: await getReconfirmDelay(bookingRef, now),
    today,
    timezone,
  }
}
