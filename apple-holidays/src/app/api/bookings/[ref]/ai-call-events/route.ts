/**
 * AI-call events for one booking, shaped for the WhatsApp chat timelines
 * (booking mini chat + inbox thread). Read-only.
 *
 * One event per call schedule row that has actually been dialled — answered,
 * missed, still retrying, or ringing right now — joined to the stored call
 * record (on-tour feedback / reconfirmation / post-tour) for its summary,
 * sentiment and transcript. Calls with a record but no schedule row (quick /
 * test calls) are included as answered. The recording itself streams lazily
 * from /api/te/recordings/:conversationId/audio when someone presses play.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { whatsappInboxCountry } from '@/lib/whatsapp'
import { classifyFeedback, type FeedbackClass } from '@/lib/te/feedback-class'
import type { OperationCountry, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const ALLOWED: UserRole[] = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

type Kind = 'on_tour' | 'reconfirm' | 'post_tour'
// 'blocked' = never dialled: the guest hasn't allowed WhatsApp calls yet, or
// there's no number. The voice service files those as missed/failed, but they
// aren't missed calls and the chat shows them as a slim note, not a card.
type State = 'answered' | 'missed' | 'retrying' | 'calling' | 'blocked'
const BLOCKED_ERR = /awaiting call approval|no phone/i

export interface AiCallEvent {
  uid: string
  kind: Kind
  dayNo: number | null
  state: State
  at: string
  attempts: number
  nextAttemptAt: string | null
  error: string | null
  conversationId: string | null
  sentiment: string | null
  outcome: string | null
  rating: number | null
  summary: string | null
  issues: string | null
  verdict: FeedbackClass | null
  verdictReason: string | null
  transcript: unknown
  transcriptTurns: number
}

const CONNECTED = new Set(['answered', 'done', 'completed'])
const MISSED = new Set(['missed', 'failed', 'no_answer', 'busy', 'rejected'])
const CALLING = new Set(['calling', 'in_progress', 'ringing'])

function kindOf(phase: string | null | undefined): Kind {
  const p = (phase ?? '').toLowerCase()
  if (['reconfirm', 'reconfirmation', 'pre_tour'].includes(p)) return 'reconfirm'
  if (['post_tour', 'posttour'].includes(p)) return 'post_tour'
  return 'on_tour'
}
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const turns = (t: unknown) => (Array.isArray(t) ? t.length : typeof t === 'string' ? t.split('\n').filter(Boolean).length : 0)

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!ALLOWED.includes(role)) return buildApiError('Forbidden', 403)

  const ref = String(params.ref ?? '').trim().toUpperCase()
  const booking = await prisma.booking.findUnique({ where: { bookingRef: ref }, select: { operationCountry: true } })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = (session.user.country ?? 'ALL') as OperationCountry
  const vnDesk = whatsappInboxCountry(role)
  if (vnDesk && booking.operationCountry !== vnDesk) return buildApiError('Forbidden', 403)
  if (!canSeeAllCountries(role, userCountry) && !isInCountryScope(booking.operationCountry, userCountry)) {
    return buildApiError('Forbidden', 403)
  }

  const [service, schedule, onTour, reconfirm, postTour] = await Promise.all([
    prisma.tbl_te_service.findUnique({ where: { booking_ref: ref }, select: { call_phone: true, customer_phone: true } }),
    prisma.tbl_te_call_schedule.findMany({
      where: { booking_ref: ref },
      select: {
        id: true, day_no: true, call_date: true, scheduled_at: true, phase: true, status: true,
        attempts: true, last_attempt_at: true, next_attempt_at: true, conversation_id: true, error: true,
      },
      orderBy: { call_date: 'asc' },
      take: 120,
    }),
    prisma.tbl_te_feedback.findMany({ where: { booking_ref: ref }, orderBy: { created_at: 'asc' }, take: 120 }),
    prisma.tbl_te_reconfirmation.findMany({ where: { booking_ref: ref }, orderBy: { created_at: 'asc' }, take: 40 }),
    prisma.tbl_te_post_tour.findMany({ where: { booking_ref: ref }, orderBy: { created_at: 'asc' }, take: 40 }),
  ])

  // Every stored call record in one shape, keyed by schedule row when it has one.
  type Rec = Pick<AiCallEvent, 'kind' | 'sentiment' | 'outcome' | 'rating' | 'summary' | 'issues' | 'transcript' | 'transcriptTurns' | 'verdict' | 'verdictReason'> & {
    uid: string; scheduleId: string | null; conversationId: string | null; at: Date; dayNo: number | null
  }
  const verdict = (kind: Kind, r: { sentiment: string | null; outcome: string | null; rating: number | null; raw: unknown; transcript: unknown }, detail: Record<string, unknown>) => {
    try {
      const v = classifyFeedback({ kind, sentiment: r.sentiment, outcome: r.outcome, rating: r.rating, detail, raw: r.raw, transcriptTurns: turns(r.transcript), alerts: [] })
      return { verdict: v.cls, verdictReason: v.reason }
    } catch { return { verdict: null, verdictReason: null } }
  }
  const records: Rec[] = [
    ...onTour.map((r): Rec => {
      const detail = { highlights: r.highlights, issues: r.issues, hotel_ok: r.hotel_ok, meals_ok: r.meals_ok, driver_ok: r.driver_ok, vehicle_ok: r.vehicle_ok }
      return {
        uid: `on_tour-${r.id}`, kind: 'on_tour', scheduleId: r.schedule_id != null ? String(r.schedule_id) : null,
        conversationId: r.conversation_id, at: r.created_at, dayNo: r.day_no,
        sentiment: r.sentiment, outcome: null, rating: null, summary: r.summary, issues: r.issues,
        transcript: r.transcript, transcriptTurns: turns(r.transcript),
        ...verdict('on_tour', { ...r, outcome: null, rating: null }, detail),
      }
    }),
    ...reconfirm.map((r): Rec => ({
      uid: `reconfirm-${r.id}`, kind: 'reconfirm', scheduleId: r.schedule_id != null ? String(r.schedule_id) : null,
      conversationId: r.conversation_id, at: r.created_at, dayNo: null,
      sentiment: r.sentiment, outcome: r.outcome, rating: null, summary: r.summary,
      issues: r.requested_change || null,
      transcript: r.transcript, transcriptTurns: turns(r.transcript),
      ...verdict('reconfirm', { ...r, rating: null }, { dates_ok: r.dates_ok, flight_ok: r.flight_ok, pax_ok: r.pax_ok, contact_ok: r.contact_ok, requested_change: r.requested_change, special_requests: r.special_requests, notes: r.notes }),
    })),
    ...postTour.map((r): Rec => ({
      uid: `post_tour-${r.id}`, kind: 'post_tour', scheduleId: r.schedule_id != null ? String(r.schedule_id) : null,
      conversationId: r.conversation_id, at: r.created_at, dayNo: null,
      sentiment: r.sentiment, outcome: r.outcome, rating: r.rating, summary: r.summary,
      issues: r.improvements || null,
      transcript: r.transcript, transcriptTurns: turns(r.transcript),
      ...verdict('post_tour', r, { reached_home_safely: r.reached_home_safely, would_recommend: r.would_recommend, best_moment: r.best_moment, improvements: r.improvements, comment: r.comment }),
    })),
  ]
  const bySchedule = new Map<string, Rec>()
  for (const r of records) if (r.scheduleId) bySchedule.set(r.scheduleId, r) // latest wins (asc order)

  const recFields = (r: Rec) => ({
    sentiment: r.sentiment, outcome: r.outcome, rating: r.rating, summary: r.summary, issues: r.issues,
    verdict: r.verdict, verdictReason: r.verdictReason, transcript: r.transcript, transcriptTurns: r.transcriptTurns,
  })
  const empty = {
    sentiment: null, outcome: null, rating: null, summary: null, issues: null,
    verdict: null, verdictReason: null, transcript: null, transcriptTurns: 0,
  }

  const events: AiCallEvent[] = []
  const usedSchedule = new Set<string>()
  const today = new Date().toISOString().slice(0, 10)
  let next: { kind: Kind; dayNo: number | null; at: string } | null = null

  for (const s of schedule) {
    const sid = String(s.id)
    const status = s.status.toLowerCase()
    const rec = bySchedule.get(sid)
    let state: State | null = null
    if (rec || CONNECTED.has(status)) state = 'answered'
    else if (CALLING.has(status)) state = 'calling'
    else if (MISSED.has(status)) state = 'missed'
    else if (status === 'pending' && s.attempts > 0) state = 'retrying'
    if ((state === 'missed' || state === 'retrying') && s.error && BLOCKED_ERR.test(s.error)) state = 'blocked'

    if (!state) {
      // Not dialled yet — remember the earliest upcoming one for the "next call" chip.
      const when = s.scheduled_at ?? s.call_date
      if (status === 'pending' && when && iso(when)!.slice(0, 10) >= today && (!next || when.toISOString() < next.at)) {
        next = { kind: kindOf(s.phase), dayNo: kindOf(s.phase) === 'on_tour' ? s.day_no : null, at: when.toISOString() }
      }
      continue
    }
    if (rec) usedSchedule.add(sid)
    const at = (state === 'answered' ? rec?.at : null) ?? s.last_attempt_at ?? s.scheduled_at ?? s.call_date
    events.push({
      uid: `sched-${sid}`,
      kind: rec?.kind ?? kindOf(s.phase),
      dayNo: (rec?.kind ?? kindOf(s.phase)) === 'on_tour' ? s.day_no : null,
      state,
      at: at.toISOString(),
      attempts: s.attempts,
      nextAttemptAt: state === 'retrying' ? iso(s.next_attempt_at) : null,
      error: state === 'answered' ? null : s.error,
      conversationId: rec?.conversationId ?? s.conversation_id ?? null,
      ...(rec ? recFields(rec) : empty),
    })
  }

  // Records with no (known) schedule row: quick calls, tests, older data.
  for (const r of records) {
    if (r.scheduleId && usedSchedule.has(r.scheduleId)) continue
    if (r.scheduleId && events.some(e => e.uid === `sched-${r.scheduleId}`)) continue
    events.push({
      uid: r.uid, kind: r.kind, dayNo: r.dayNo, state: 'answered', at: r.at.toISOString(),
      attempts: 1, nextAttemptAt: null, error: null, conversationId: r.conversationId, ...recFields(r),
    })
  }

  events.sort((a, b) => a.at.localeCompare(b.at))

  return buildApiSuccess({
    phone: service?.call_phone || service?.customer_phone || null,
    events,
    next,
  })
}
