/**
 * Guest reconfirmation deadline — D-10, and the reason when it is missed.
 *
 * A tour must be reconfirmed with the guest **ten days before they travel**.
 * "Reconfirmed" is the same two-signal test the operations board already uses
 * (`ops-board-parts.tsx`): either the booking status has reached *Client
 * Confirmed*, or the TE pre-tour call has been logged. Either one on its own is
 * enough — a guest who confirmed in writing does not also need a call.
 *
 * Until now a missed deadline was a bare red cell: the board could say *that* a
 * booking was not reconfirmed but never *why*, so the same handful of files were
 * re-chased every morning by whoever read the mail. This module adds the missing
 * half — the desk that owns the file records the reason once, and the reason
 * then travels with the booking into the daily report and onto the ops board.
 *
 * Three deliberate rules:
 *
 *   • **A reason is only ever owed on a breached booking.** Asking for one
 *     before D-10 would collect noise; asking for one after the guest is
 *     reconfirmed would collect fiction.
 *   • **Hotel Only files are out of scope.** There is no tour to reconfirm, so
 *     the deadline never applies and no reason is owed — the same carve-out
 *     `hotel-only.ts` makes for every other check.
 *   • **A reason goes stale.** "Agent not responding" is a fact about last
 *     Tuesday, not a permanent excuse, so an explanation nobody has touched in
 *     `REASON_STALE_DAYS` is flagged for a refresh rather than silently
 *     accepted. This is what stops the field becoming a way to mute the board.
 *
 * Deliberately pure — no Prisma, no I/O. The booking page, the report and the
 * board all classify with these functions, so a count, a cell and a mail line
 * can never disagree about what "not reconfirmed by D-10" means.
 * `reconfirm-delay.ts` re-exports all of it for server callers.
 */

/** Days before arrival by which the guest must be reconfirmed. */
export const RECONFIRM_DUE_DAYS = 10

/** How long an explanation stands before the desk is asked to refresh it. */
export const REASON_STALE_DAYS = 3

const DAY_MS = 86_400_000

// ─── Date helpers ─────────────────────────────────────────────────────────────
// All arithmetic is whole days on `yyyy-mm-dd` strings. The deadline is a
// calendar date, not an instant: a booking is late on the eleventh morning
// whatever the clock says, and hour-level maths would only introduce timezone
// bugs into a number ops reads as a plain day count.

/** Whole days from `from` to `to`, positive when `to` is later. */
export function daysBetweenDates(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / DAY_MS)
}

/** `date` moved by `days`, as `yyyy-mm-dd`. */
export function shiftDateKey(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`)
  if (isNaN(t)) return date
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10)
}

/** The D-10 date for an arrival, as `yyyy-mm-dd`. */
export function reconfirmDueDate(arrivalDate: string): string {
  return shiftDateKey(arrivalDate, -RECONFIRM_DUE_DAYS)
}

// ─── Reasons ──────────────────────────────────────────────────────────────────

export type ReconfirmDelayReason =
  | 'AGENT_UNRESPONSIVE'
  | 'GUEST_UNREACHABLE'
  | 'AWAITING_PAYMENT'
  | 'AMENDMENT_IN_PROGRESS'
  | 'FLIGHTS_PENDING'
  | 'SERVICES_PENDING'
  | 'NO_CALL_PERMISSION'
  | 'LATE_BOOKING'
  | 'OTHER'

export interface ReconfirmReasonMeta {
  key: ReconfirmDelayReason
  /** Full text in the picker. */
  label: string
  /** Column / pill text where space is tight. */
  short: string
  /** What the reason actually claims, in ops language. */
  hint: string
  /**
   * Which desk has to clear it. The point of collecting reasons is routing: a
   * file stuck on payment belongs to Accounts, one stuck on the agent belongs to
   * the booking team, and a morning report that says so saves the meeting.
   */
  owner: string
  /** Free text is mandatory — the code alone says nothing useful. */
  requiresNote?: boolean
}

/**
 * Ordered by how often the desk reaches for them, commonest first — the picker
 * is read top-down and `OTHER` deliberately sits last so it is the reason of
 * last resort rather than the default.
 */
export const RECONFIRM_REASONS: ReconfirmReasonMeta[] = [
  {
    key: 'AGENT_UNRESPONSIVE',
    label: 'Agent not responding',
    short: 'Agent',
    hint: 'Reconfirmation was sent to the agent and they have not come back to us',
    owner: 'Booking team',
  },
  {
    key: 'GUEST_UNREACHABLE',
    label: 'Guest unreachable',
    short: 'Guest',
    hint: 'Phone unanswered, wrong number or no contact details on file',
    owner: 'Travel Experience',
  },
  {
    key: 'AWAITING_PAYMENT',
    label: 'Awaiting payment',
    short: 'Payment',
    hint: 'Deposit or balance outstanding — the file cannot be confirmed until it clears',
    owner: 'Accounts',
  },
  {
    key: 'AMENDMENT_IN_PROGRESS',
    label: 'Amendment in progress',
    short: 'Amendment',
    hint: 'The itinerary is being changed, so there is nothing settled to reconfirm yet',
    owner: 'Booking team',
  },
  {
    key: 'FLIGHTS_PENDING',
    label: 'Flights not issued',
    short: 'Flights',
    hint: 'Arrival or departure flights are not ticketed, so the dates are not final',
    owner: 'Booking team',
  },
  {
    key: 'SERVICES_PENDING',
    label: 'Supplier services pending',
    short: 'Suppliers',
    hint: 'Hotels or excursions are still unconfirmed — reconfirming now risks promising the guest a service we do not hold',
    owner: 'Ground team',
  },
  {
    key: 'NO_CALL_PERMISSION',
    label: 'No WhatsApp call permission',
    short: 'WA permission',
    hint: 'The guest has not accepted the WhatsApp request, so the bot is not allowed to call',
    owner: 'Travel Experience',
  },
  {
    key: 'LATE_BOOKING',
    label: 'Booked inside the D-10 window',
    short: 'Late booking',
    hint: 'The booking arrived less than 10 days before travel — the deadline was never reachable',
    owner: 'No owner — deadline unreachable',
  },
  {
    key: 'OTHER',
    label: 'Other — explain',
    short: 'Other',
    hint: 'Anything the list above does not cover. A written explanation is required.',
    owner: 'Recorded by',
    requiresNote: true,
  },
]

export const REASON_META: Record<ReconfirmDelayReason, ReconfirmReasonMeta> =
  Object.fromEntries(RECONFIRM_REASONS.map(r => [r.key, r])) as Record<ReconfirmDelayReason, ReconfirmReasonMeta>

export function isReconfirmReason(v: unknown): v is ReconfirmDelayReason {
  return typeof v === 'string' && v in REASON_META
}

/** Reason label, falling back to the raw code so an unknown value is never silently blank. */
export function reasonLabel(reason: string): string {
  return isReconfirmReason(reason) ? REASON_META[reason].label : reason
}

// ─── The recorded explanation ─────────────────────────────────────────────────

/** One booking's answer to "why was this not reconfirmed by D-10?". */
export interface ReconfirmDelay {
  bookingRef: string
  reason: ReconfirmDelayReason
  reasonLabel: string
  /** Free text. Always present for `OTHER`, optional otherwise. */
  note: string | null
  /** ISO — when the explanation was last written or updated. */
  recordedAt: string
  recordedBy: string | null
  /** Whole days since it was last touched. */
  ageDays: number
  /** Untouched for `REASON_STALE_DAYS` — the explanation itself needs chasing. */
  stale: boolean
}

// ─── Standing against the deadline ────────────────────────────────────────────

export type ReconfirmStandingState =
  /** Hotel Only — there is no tour to reconfirm. */
  | 'NA'
  /** Reconfirmed: client confirmed, or the pre-tour call is logged. */
  | 'DONE'
  /** Past D-10, guest has not travelled yet, and still not reconfirmed. */
  | 'BREACHED'
  /** D-10 is today. */
  | 'DUE'
  /** Still inside the window. */
  | 'UPCOMING'
  /**
   * The guest has already travelled without being reconfirmed. A failure, but a
   * closed one — there is nothing left to chase, and holding it open would leave
   * every on-ground tour permanently red on the board.
   */
  | 'PAST'

export interface ReconfirmStandingInput {
  /** `yyyy-mm-dd`. */
  arrivalDate: string
  /** `yyyy-mm-dd` in the operations timezone. */
  today: string
  /** Booking status has reached "Client Confirmed" or beyond. */
  clientConfirmed: boolean
  /** A TE pre-tour reconfirmation call has been logged. */
  preTourCalled: boolean
  /** Accommodation-only file — see `hotel-only.ts`. */
  hotelOnly?: boolean
}

export interface ReconfirmStanding {
  state: ReconfirmStandingState
  /** The D-10 date, `yyyy-mm-dd`. */
  dueAt: string
  /** Days until D-10; negative once it is past. */
  daysToDue: number
  /** Days until the guest travels; negative once they have. */
  daysToArrival: number
  /** Past the deadline with neither reconfirmation signal in. */
  breached: boolean
  /** An explanation is owed for this booking right now. */
  needsReason: boolean
}

/**
 * Where one booking stands against its D-10 deadline.
 *
 * `needsReason` is the field everything else keys off: it is true only while the
 * deadline is genuinely missed, so a reason is never demanded for a file that is
 * either fine, not yet due, or out of scope.
 */
export function classifyReconfirm(input: ReconfirmStandingInput): ReconfirmStanding {
  const dueAt = reconfirmDueDate(input.arrivalDate)
  const daysToDue = daysBetweenDates(input.today, dueAt)
  const daysToArrival = daysBetweenDates(input.today, input.arrivalDate)
  const base = { dueAt, daysToDue, daysToArrival }

  if (input.hotelOnly) {
    return { ...base, state: 'NA', breached: false, needsReason: false }
  }
  if (input.clientConfirmed || input.preTourCalled) {
    return { ...base, state: 'DONE', breached: false, needsReason: false }
  }
  if (daysToDue < 0) {
    return { ...base, state: 'BREACHED', breached: true, needsReason: true }
  }
  return {
    ...base,
    state: daysToDue === 0 ? 'DUE' : 'UPCOMING',
    breached: false,
    needsReason: false,
  }
}

/**
 * The one-line the board, the mail and the booking page all print for a breached
 * booking — the reason if there is one, and an explicit demand if there is not.
 *
 * Silence is never rendered as "fine": a missing explanation is itself reported,
 * because an unexplained breach is the one the desk most needs to see.
 */
export function delaySummary(
  standing: ReconfirmStanding,
  delay: ReconfirmDelay | null,
): string {
  if (!standing.breached) return ''
  const late = `${Math.abs(standing.daysToDue)} day${standing.daysToDue === -1 ? '' : 's'} past D-${RECONFIRM_DUE_DAYS}`
  if (!delay) return `${late} — no reason recorded`
  const who = delay.recordedBy ? ` by ${delay.recordedBy}` : ''
  const age = delay.stale ? `, not updated in ${delay.ageDays} days` : ''
  return `${late} — ${delay.reasonLabel}${delay.note ? `: ${delay.note}` : ''} (recorded${who}${age})`
}
