/**
 * Loading the Daily Update sheet's call columns.
 *
 * Server-only — kept apart from `daily-update-calls.ts` because the sheet is a
 * client component that needs the labels and types from there, and a Prisma
 * import in that module would drag the server runtime into the browser bundle.
 */

import { prisma } from '@/lib/prisma'
import {
  CALL_KINDS, CALL_TYPE_PREFIX, callKindFromType, emptyCalls,
  type BookingCalls, type CallEntry, type CallKind,
} from '@/lib/daily-update-calls'
import {
  FEEDBACK_RATING_FIELDS, emptyFeedbackForm, type FeedbackFormCell,
} from '@/lib/daily-update-feedback'
import { TAG_FEEDBACK_REQUEST } from '@/lib/customer-whatsapp-automation'

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
      where: { bookingId: { in: ids }, type: { startsWith: CALL_TYPE_PREFIX } },
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
    // The bot's post-tour call both wraps the file up and collects the rating,
    // which is exactly what the merged Post-tour Feedback column reports.
    push(idByRef.get(p.booking_ref), 'POST', {
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

/**
 * The digital feedback form for a page of bookings — the submission if there is
 * one, and when the form was last sent on WhatsApp if there is not.
 *
 * Two queries for the whole page, same reason as the calls above. Both are
 * plain reads of tables that already exist: `guest_feedback_forms` is written
 * by the public form at `/feedback/[ref]`, and the send is inferred from the
 * `[FEEDBACK-REQUEST]`-tagged outbound rows the automation already logs.
 */
export async function fetchFeedbackFormsForBookings(
  bookings: { id: string; bookingRef: string }[],
): Promise<Record<string, FeedbackFormCell>> {
  const out: Record<string, FeedbackFormCell> = {}
  for (const b of bookings) out[b.id] = emptyFeedbackForm()
  if (bookings.length === 0) return out

  const ids  = bookings.map(b => b.id)
  const refs = bookings.map(b => b.bookingRef)
  const idByRef = new Map(bookings.map(b => [b.bookingRef, b.id]))

  const [forms, sends] = await Promise.all([
    prisma.guestFeedbackForm.findMany({
      where: { bookingId: { in: ids } },
      select: {
        bookingId: true, submittedAt: true, clientName: true, purpose: true,
        overallExperience: true, remarks: true,
        accommodationRoom: true, accommodationFood: true,
        restaurantFood: true, restaurantAmbience: true,
        transportVehicle: true, transportDriver: true,
      },
    }),
    prisma.whatsAppMessage.findMany({
      where: {
        bookingRef: { in: refs },
        direction: 'outbound',
        senderName: { startsWith: TAG_FEEDBACK_REQUEST },
      },
      select: { bookingRef: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  for (const f of forms) {
    const cell = out[f.bookingId]
    if (!cell) continue
    const row = f as unknown as Record<string, unknown>
    cell.form = {
      submittedAt: f.submittedAt.toISOString(),
      clientName:  f.clientName,
      purpose:     f.purpose ? String(f.purpose) : null,
      overall:     f.overallExperience ? String(f.overallExperience) : null,
      remarks:     f.remarks,
      ratings: Object.fromEntries(
        FEEDBACK_RATING_FIELDS.map(({ key }) => [key, row[key] ? String(row[key]) : null]),
      ),
    }
  }

  // Newest first, so the first row seen for a ref is the most recent send.
  for (const s of sends) {
    const id = idByRef.get(s.bookingRef)
    if (!id || !out[id] || out[id].sentAt) continue
    out[id].sentAt = s.createdAt.toISOString()
  }

  return out
}
