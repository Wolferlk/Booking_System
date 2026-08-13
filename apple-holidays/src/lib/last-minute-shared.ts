/**
 * Last-minute bookings — D-4, and why the whole team has to be told.
 *
 * A booking that lands **four days or fewer before the guest arrives** is not a
 * normal file that happens to be urgent; it is a different job. Every lead-time
 * the operation depends on has already expired by the time it is created:
 * hotels are on same-week rates or sold out, the D-10 guest reconfirmation
 * deadline was never reachable, drivers and guides are allocated, entrance
 * tickets on some products need a day's notice, and Accounts has no float to
 * approve against. If nobody notices it for a morning, the tour is already
 * compromised — and the one thing that reliably fails on a late file is that
 * *nobody noticed*.
 *
 * So this module defines one thing precisely: what "last minute" means. It is a
 * fact about **how the booking was sold**, not about today's date —
 *
 *     leadDays = arrivalDate − createdAt   (whole calendar days)
 *     lastMinute ⟺ 0 ≤ leadDays ≤ 4
 *
 * Two consequences follow, and both are deliberate:
 *
 *  • **It never changes.** A file booked three days out is a last-minute file
 *    forever, and still reads as one in next quarter's review. Defining it as
 *    "arrival is within the next 4 days" instead would make *every* booking
 *    last-minute eventually, which would make the badge meaningless.
 *  • **A back-entered file is not last minute.** `leadDays < 0` means the record
 *    was created after the guest had already arrived — historical data entry, an
 *    AppleSystem back-fill, an import of an old tour. Nothing was sold late, so
 *    nothing is alarmed. That guard is the only reason a bulk import cannot set
 *    off a thousand sirens.
 *
 * The *alert* is a narrower question than the *badge* — see `isAlertable()`. A
 * booking is badged for life but only shouted about while the shout can still
 * change the outcome.
 *
 * Deliberately pure: no Prisma, no I/O, no React. The badge in the bookings
 * list, the header alert, the API and any report all classify with these
 * functions, so a chip, a count and a popup can never disagree about what
 * "last minute" means. `last-minute.ts` re-exports all of it for server callers.
 */

/** Lead time at or below which a booking counts as last minute — the "D-4" rule. */
export const LAST_MINUTE_DAYS = 4

const DAY_MS = 86_400_000

// ─── Date keys ────────────────────────────────────────────────────────────────
// Everything here is whole calendar days on `yyyy-mm-dd` strings. Lead time is a
// day count an operator says out loud ("booked three days out"), not an interval
// in hours, and hour-level arithmetic would only import timezone bugs into it.

/**
 * The calendar date of an *instant* (`createdAt`), in `timeZone`.
 *
 * Defaults to the runtime's own zone, which is the right answer in both places
 * it runs: in the browser that is the operator's zone, and on the server the
 * callers that care pass the operations zone explicitly.
 */
export function instantDateKey(value: string | Date, timeZone?: string): string {
  const at = value instanceof Date ? value : new Date(value)
  if (isNaN(at.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

/**
 * The calendar date of a *date-only* column (`arrivalDate`).
 *
 * Arrival is stored as midnight UTC standing for a plain calendar day, so the
 * date is read straight off the front of the ISO string. Re-projecting it into a
 * timezone would be actively wrong: west of UTC it would move the guest's
 * arrival back a day.
 */
export function arrivalDateKey(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const at = value instanceof Date ? value : new Date(value)
  if (isNaN(at.getTime())) return ''
  return at.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`, positive when `to` is later. */
export function daysBetweenKeys(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / DAY_MS)
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * How loud this one is. The band is chosen by what the desk can still *do*,
 * which is why it is graded rather than a single flag: a file arriving in four
 * days can still be worked normally under pressure, one arriving tomorrow cannot.
 */
export type LastMinuteTier =
  /** Arrives today or tomorrow — nothing can be ordered, only confirmed. */
  | 'CRITICAL'
  /** Two days out — hotels and transport must be closed today. */
  | 'URGENT'
  /** Three or four days out — workable, but every deadline is already tight. */
  | 'TIGHT'

export interface LastMinuteTierMeta {
  tier: LastMinuteTier
  /** Chip / popup wording. */
  label: string
  /** What the desk is being told to do about it. */
  hint: string
  /** Tailwind classes for a small badge, borrowed by every screen so they match. */
  badgeClass: string
  /** Tailwind classes for the popup's header band. */
  bandClass: string
  /** The popup uses the harsh alarm for these; the rest get the softer chime. */
  alarm: boolean
}

export const LAST_MINUTE_TIERS: Record<LastMinuteTier, LastMinuteTierMeta> = {
  CRITICAL: {
    tier: 'CRITICAL',
    label: 'Last minute · critical',
    hint: 'The guest is here today or tomorrow. Nothing can be ordered any more — confirm the hotel, the driver and the airport meeting now, and tell Accounts.',
    badgeClass: 'bg-red-600 text-white border-red-700',
    bandClass: 'bg-red-600',
    alarm: true,
  },
  URGENT: {
    tier: 'URGENT',
    label: 'Last minute · urgent',
    hint: 'Two days out. Hotels, transport and any ticket that needs a day of notice have to be closed today.',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
    bandClass: 'bg-orange-500',
    alarm: true,
  },
  TIGHT: {
    tier: 'TIGHT',
    label: 'Last minute',
    hint: 'Booked inside D-4. Workable, but the guest reconfirmation deadline is already gone and every supplier is on short notice.',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
    bandClass: 'bg-amber-500',
    alarm: false,
  },
}

export interface LastMinuteInput {
  /** The instant the booking record was created. */
  createdAt: string | Date
  /** The guest's arrival — a calendar date. */
  arrivalDate: string | Date
  /** `yyyy-mm-dd` today, in the operations zone. Only used for the alert half. */
  today?: string
  /** Booking status; cancelled files are never alerted on. */
  status?: string | null
  /** Timezone used to read `createdAt`'s calendar day. Defaults to the runtime's. */
  timeZone?: string
}

export interface LastMinuteStanding {
  /** Whole days from creation to arrival. Negative on a back-entered file. */
  leadDays: number
  /** Sold inside the D-4 window — the badge, and it never changes. */
  lastMinute: boolean
  /** Only meaningful when `lastMinute`. */
  tier: LastMinuteTier | null
  /** Days from `today` to arrival; negative once the guest has landed. */
  daysToArrival: number
  /** Cancelled, or awaiting a cancellation decision. */
  cancelled: boolean
  /** Still worth interrupting the team about — see `isAlertable()`. */
  alertable: boolean
}

/** Cancelled files never ran, so they are never alarmed about. */
const DEAD_STATUSES = new Set(['CANCELLED', 'PENDING_CANCELLATION'])

function tierFor(leadDays: number): LastMinuteTier {
  if (leadDays <= 1) return 'CRITICAL'
  if (leadDays === 2) return 'URGENT'
  return 'TIGHT'
}

/**
 * Where one booking stands on the D-4 rule.
 *
 * `lastMinute` is the permanent fact (the badge). `alertable` is the perishable
 * one (the popup): a last-minute booking is only shouted about while the guest
 * has not yet arrived and the file is alive, because an alarm nobody can act on
 * is an alarm everybody learns to dismiss.
 */
export function classifyLastMinute(input: LastMinuteInput): LastMinuteStanding {
  const created  = instantDateKey(input.createdAt, input.timeZone)
  const arrival  = arrivalDateKey(input.arrivalDate)
  const leadDays = created && arrival ? daysBetweenKeys(created, arrival) : 0

  // `leadDays < 0` is a record created after the guest arrived — back-entry, not
  // a late sale. Excluding it is what keeps a historical import silent.
  const lastMinute = Boolean(created && arrival) && leadDays >= 0 && leadDays <= LAST_MINUTE_DAYS
  const cancelled  = DEAD_STATUSES.has(String(input.status ?? ''))
  const daysToArrival = input.today ? daysBetweenKeys(input.today, arrival) : 0

  return {
    leadDays,
    lastMinute,
    tier: lastMinute ? tierFor(leadDays) : null,
    daysToArrival,
    cancelled,
    alertable: lastMinute && !cancelled && Boolean(input.today) && daysToArrival >= 0,
  }
}

/** Convenience for screens that only need the badge. */
export function isLastMinuteBooking(booking: { createdAt: string | Date; arrivalDate: string | Date }): boolean {
  return classifyLastMinute(booking).lastMinute
}

// ─── Wording ──────────────────────────────────────────────────────────────────

/** The badge text, e.g. `D-3`. Kept in one place so no screen invents its own. */
export function leadLabel(leadDays: number): string {
  return `D-${Math.max(0, leadDays)}`
}

/** How the sale reads in a sentence: "booked 3 days before arrival". */
export function leadSentence(leadDays: number): string {
  if (leadDays <= 0) return 'booked on the day of arrival'
  return `booked ${leadDays} day${leadDays === 1 ? '' : 's'} before arrival`
}

/** How near the guest is: "arrives today", "arrives in 2 days". */
export function arrivalSentence(daysToArrival: number): string {
  if (daysToArrival < 0) return `arrived ${Math.abs(daysToArrival)} day${daysToArrival === -1 ? '' : 's'} ago`
  if (daysToArrival === 0) return 'arrives today'
  if (daysToArrival === 1) return 'arrives tomorrow'
  return `arrives in ${daysToArrival} days`
}

/**
 * The one line the popup, the tooltip and any report print for a late file.
 *
 * Both halves are said on purpose: how late it was sold (the permanent fact) and
 * how near the guest now is (the perishable one). Either alone reads as less
 * urgent than the file actually is.
 */
export function lastMinuteSummary(standing: LastMinuteStanding, withArrival = true): string {
  if (!standing.lastMinute) return ''
  const sold = `${leadLabel(standing.leadDays)} — ${leadSentence(standing.leadDays)}`
  return withArrival ? `${sold}, ${arrivalSentence(standing.daysToArrival)}` : sold
}
