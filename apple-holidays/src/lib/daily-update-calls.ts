/**
 * Guest-call tracking for the Daily Update sheet.
 *
 * Four moments the desk cares about on every file — the pre-trip call, the
 * calls made while the guest is on the ground, the wrap-up call after they
 * leave, and the call that chases a review. The sheet has to say, per booking,
 * whether each one happened, when, and what came of it.
 *
 * Two sources feed each column:
 *
 *  1. **The AI call bot.** `tbl_te_reconfirmation`, `tbl_te_feedback` and
 *     `tbl_te_post_tour` already hold real calls the bot placed, with their own
 *     summaries and timestamps. Those are read-only here — this sheet reports
 *     them, it does not own them.
 *  2. **Manual entries**, recorded by whoever picked up the phone.
 *
 * Manual entries are stored in the existing `ContactLog` table rather than a
 * new one: it already has exactly the shape needed (booking, user, free-form
 * type, subject, notes, timestamp), it is related to `Booking` with the right
 * cascade, and it carries no rows today — so nothing is migrated, no live
 * schema is touched, and no existing feature can be disturbed by the values
 * written here.
 *
 * This module is deliberately Prisma-free: the sheet is a client component and
 * imports these labels and types, so anything reaching for the database here
 * would pull the server runtime into the browser bundle. The loader lives in
 * `daily-update-calls-data.ts`.
 */

/** The four columns, in the order they happen. */
export const CALL_KINDS = ['PRE', 'ON_GROUND', 'POST', 'FEEDBACK'] as const
export type CallKind = typeof CALL_KINDS[number]

export const CALL_LABELS: Record<CallKind, string> = {
  PRE:       'Pre call',
  ON_GROUND: 'On-ground call',
  POST:      'Post call',
  FEEDBACK:  'Feedback call',
}

export const CALL_HINTS: Record<CallKind, string> = {
  PRE:       'Pre-trip reconfirmation — dates, flights, pax and contact confirmed before arrival',
  ON_GROUND: 'Calls made while the guest is on the ground — one entry per call',
  POST:      'Wrap-up call after the guest leaves',
  FEEDBACK:  'Review / rating collection call',
}

/**
 * `ContactLog.type` values. Namespaced so they can never be confused with
 * whatever the Contact Log page writes in future — the column is free text.
 */
export const CALL_TYPE_PREFIX = 'DU_CALL_'
export const callLogType = (kind: CallKind) => `${CALL_TYPE_PREFIX}${kind}`

export function callKindFromType(type: string): CallKind | null {
  if (!type.startsWith(CALL_TYPE_PREFIX)) return null
  const kind = type.slice(CALL_TYPE_PREFIX.length) as CallKind
  return (CALL_KINDS as readonly string[]).includes(kind) ? kind : null
}

export function isCallKind(value: unknown): value is CallKind {
  return typeof value === 'string' && (CALL_KINDS as readonly string[]).includes(value)
}

export type CallEntry = {
  id:        string
  /** Manual entries can be edited and deleted; AI records cannot. */
  source:    'MANUAL' | 'AI'
  /** ISO timestamp of the call itself, not of the row being written. */
  at:        string
  summary:   string
  notes:     string | null
  /** Who logged it — the staff member, or the bot. */
  by:        string | null
  /** AI only: how the call ended, and how the guest sounded. */
  outcome:   string | null
  sentiment: string | null
}

/** Everything the sheet shows for one column of one booking. */
export type CallCell = {
  count:   number
  /** Most recent entry — the one the cell renders inline. */
  latest:  CallEntry | null
  entries: CallEntry[]
}

export type BookingCalls = Record<CallKind, CallCell>

const emptyCell = (): CallCell => ({ count: 0, latest: null, entries: [] })

export function emptyCalls(): BookingCalls {
  return { PRE: emptyCell(), ON_GROUND: emptyCell(), POST: emptyCell(), FEEDBACK: emptyCell() }
}
