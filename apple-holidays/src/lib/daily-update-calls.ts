/**
 * Guest-call tracking for the Daily Update sheet.
 *
 * Three moments the desk cares about on every file — the pre-trip
 * reconfirmation, the calls made while the guest is on the ground, and the
 * post-tour feedback call once they have left. The sheet has to say, per
 * booking, whether each one happened, when, and what came of it.
 *
 * There were four until the desk pointed out that "Post call" and "Feedback
 * call" were the same conversation being logged twice: one call is made after
 * departure and it both wraps the file up and collects the review. They are now
 * a single **Post-tour Feedback** column. `POST` stayed the canonical kind so
 * every `DU_CALL_POST` row already in `ContactLog` keeps its column, and
 * `DU_CALL_FEEDBACK` is read as an alias of it — nothing was migrated, nothing
 * was deleted, and no schema changed.
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

/** The three columns, in the order they happen. */
export const CALL_KINDS = ['PRE', 'ON_GROUND', 'POST'] as const
export type CallKind = typeof CALL_KINDS[number]

export const CALL_LABELS: Record<CallKind, string> = {
  PRE:       'Pre-trip Reconfirmation',
  ON_GROUND: 'On-ground call',
  POST:      'Post-tour Feedback',
}

export const CALL_HINTS: Record<CallKind, string> = {
  PRE:       'Dates, flights, pax and contact confirmed with the guest before arrival',
  ON_GROUND: 'Calls made while the guest is on the ground — one entry per call',
  POST:      'The call after departure — how the trip went, and the rating collected',
}

/**
 * `ContactLog.type` values. Namespaced so they can never be confused with
 * whatever the Contact Log page writes in future — the column is free text.
 */
export const CALL_TYPE_PREFIX = 'DU_CALL_'
export const callLogType = (kind: CallKind) => `${CALL_TYPE_PREFIX}${kind}`

/**
 * Kinds that were written before the Post and Feedback columns were merged.
 * Read, never written — the map is what keeps an already-logged entry visible
 * in the column that replaced its own.
 */
const LEGACY_KIND_ALIASES: Record<string, CallKind> = { FEEDBACK: 'POST' }

export function callKindFromType(type: string): CallKind | null {
  if (!type.startsWith(CALL_TYPE_PREFIX)) return null
  const kind = type.slice(CALL_TYPE_PREFIX.length)
  if ((CALL_KINDS as readonly string[]).includes(kind)) return kind as CallKind
  return LEGACY_KIND_ALIASES[kind] ?? null
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
  return Object.fromEntries(CALL_KINDS.map(k => [k, emptyCell()])) as BookingCalls
}
