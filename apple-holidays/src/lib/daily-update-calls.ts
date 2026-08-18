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
 */

import { prisma } from '@/lib/prisma'

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
const TYPE_PREFIX = 'DU_CALL_'
export const callLogType = (kind: CallKind) => `${TYPE_PREFIX}${kind}`

export function callKindFromType(type: string): CallKind | null {
  if (!type.startsWith(TYPE_PREFIX)) return null
  const kind = type.slice(TYPE_PREFIX.length) as CallKind
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

/** First non-empty of several optional text columns, trimmed and capped. */
function firstText(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = (c ?? '').trim()
    if (t) return t.length > 400 ? `${t.slice(0, 397)}…` : t
  }
  return ''
}

/**
 * Loads every call for a page of bookings in four queries rather than four per
 * row — the sheet routinely renders several hundred bookings, so anything
 * per-row would be the page's dominant cost.
 *
 * Keyed by booking id. The AI tables key on `booking_ref` instead, so the
 * caller supplies both and they are joined here.
 */
export async function fetchCallsForBookings(
  bookings: { id: string; bookingRef: string }[],
): Promise<Record<string, BookingCalls>> {
  const out: Record<string, BookingCalls> = {}
  for (const b of bookings) out[b.id] = emptyCalls()
  if (bookings.length === 0) return out

  const ids  = bookings.map(b => b.id)
  const refs = bookings.map(b => b.bookingRef)
  const idByRef = new Map(bookings.map(b => [b.bookingRef, b.id]))

  const [manual, reconfirmations, onTour, postTour] = await Promise.all([
    prisma.contactLog.findMany({
      where: { bookingId: { in: ids }, type: { startsWith: TYPE_PREFIX } },
      select: {
        id: true, bookingId: true, type: true, subject: true, notes: true, contactedAt: true,
        user: { select: { name: true } },
      },
      orderBy: { contactedAt: 'desc' },
    }),
    prisma.tbl_te_reconfirmation.findMany({
      where: { booking_ref: { in: refs } },
      select: {
        id: true, booking_ref: true, summary: true, notes: true, requested_change: true,
        outcome: true, sentiment: true, created_at: true,
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.tbl_te_feedback.findMany({
      where: { booking_ref: { in: refs } },
      select: {
        id: true, booking_ref: true, summary: true, highlights: true, issues: true,
        sentiment: true, call_date: true, created_at: true, day_no: true,
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.tbl_te_post_tour.findMany({
      where: { booking_ref: { in: refs } },
      select: {
        id: true, booking_ref: true, summary: true, comment: true, best_moment: true,
        rating: true, outcome: true, sentiment: true, created_at: true,
      },
      orderBy: { created_at: 'desc' },
    }),
  ])

  const push = (bookingId: string | undefined, kind: CallKind, entry: CallEntry) => {
    if (!bookingId || !out[bookingId]) return
    out[bookingId][kind].entries.push(entry)
  }

  for (const m of manual) {
    const kind = callKindFromType(m.type)
    if (!kind) continue
    push(m.bookingId, kind, {
      id:        m.id,
      source:    'MANUAL',
      at:        m.contactedAt.toISOString(),
      summary:   m.subject,
      notes:     m.notes,
      by:        m.user?.name ?? null,
      outcome:   null,
      sentiment: null,
    })
  }

  for (const r of reconfirmations) {
    push(idByRef.get(r.booking_ref), 'PRE', {
      id:        `ai-pre-${r.id}`,
      source:    'AI',
      at:        r.created_at.toISOString(),
      summary:   firstText(r.summary, r.requested_change, 'Reconfirmation call completed'),
      notes:     firstText(r.notes) || null,
      by:        'AI call bot',
      outcome:   r.outcome,
      sentiment: r.sentiment,
    })
  }

  for (const f of onTour) {
    // `call_date` is the day the call belongs to; `created_at` is when the
    // record landed. The former is what the desk means by "when was it called".
    const at = f.call_date ?? f.created_at
    push(idByRef.get(f.booking_ref), 'ON_GROUND', {
      id:        `ai-og-${f.id}`,
      source:    'AI',
      at:        at.toISOString(),
      summary:   firstText(f.summary, f.highlights, f.issues,
                           f.day_no != null ? `Day ${f.day_no} check-in call` : 'On-tour call'),
      notes:     firstText(f.issues) || null,
      by:        'AI call bot',
      outcome:   null,
      sentiment: f.sentiment,
    })
  }

  for (const p of postTour) {
    // The bot's post-tour call is the one that collects the rating, so it lands
    // in the Feedback column. The Post column is the manual wrap-up call.
    push(idByRef.get(p.booking_ref), 'FEEDBACK', {
      id:        `ai-fb-${p.id}`,
      source:    'AI',
      at:        p.created_at.toISOString(),
      summary:   firstText(
        p.rating != null ? `Rated ${p.rating}/10. ${firstText(p.summary, p.comment, p.best_moment)}`.trim() : null,
        p.summary, p.comment, p.best_moment, 'Post-tour feedback call completed',
      ),
      notes:     firstText(p.comment, p.best_moment) || null,
      by:        'AI call bot',
      outcome:   p.outcome,
      sentiment: p.sentiment,
    })
  }

  // Newest first within each cell, so `latest` is genuinely the latest whatever
  // order the four queries came back in.
  for (const bookingId of Object.keys(out)) {
    for (const kind of CALL_KINDS) {
      const cell = out[bookingId][kind]
      cell.entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      cell.count = cell.entries.length
      cell.latest = cell.entries[0] ?? null
    }
  }

  return out
}
