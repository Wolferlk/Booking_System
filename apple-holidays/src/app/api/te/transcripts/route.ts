/**
 * Unified AI-call transcripts — DB-backed (reads the three tbl_te_* tables directly).
 *
 * Merges every call record across:
 *   • tbl_te_feedback        → on-tour daily check-in calls
 *   • tbl_te_reconfirmation  → pre-tour reconfirmation calls
 *   • tbl_te_post_tour       → post-tour feedback calls
 *
 * Powers both the per-booking "Call Transcripts" component and the global
 * "Transcripts" explorer in the AI Call Bot. Country-scoped by booking-ref prefix.
 *
 * GET query params:
 *   ref        — filter to a single booking ref (exact, case-insensitive)
 *   kind       — on_tour | reconfirm | post_tour  (omit = all)
 *   sentiment  — happy | neutral | unhappy | …    (matches stored sentiment)
 *   class      — good | warning | bad | none      (feedback bucket, see feedback-class.ts)
 *   q          — free-text search across summaries, notes and detail fields
 *   from, to   — ISO dates, filter on the call/created date (inclusive)
 *   country    — admin-only country override (VIETNAM | SRILANKA | SINGAPORE | MALAYSIA | ALL)
 *   limit      — max records returned (default 300, hard cap 1000)
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import { classifyFeedback, type FeedbackAlert, type FeedbackClass } from '@/lib/te/feedback-class'
import type { UserRole, OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES: UserRole[] = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// operationCountry → booking-ref prefix (see country-detection.ts)
const COUNTRY_PREFIX: Record<string, string> = {
  VIETNAM: 'VN',
  SRILANKA: 'IS',
  SINGAPORE: 'SG',
  MALAYSIA: 'MY',
}

type Kind = 'on_tour' | 'reconfirm' | 'post_tour'

interface TranscriptRecord {
  uid: string
  kind: Kind
  id: number
  service_id: number
  schedule_id: number | null
  booking_ref: string
  customer_name: string | null
  lead_name: string | null
  operation_country: string | null
  day_no: number | null
  call_date: string | null
  at: string | null
  sentiment: string | null
  outcome: string | null
  rating: number | null
  summary: string | null
  conversation_id: string | null
  transcript: unknown
  transcript_turns: number
  // kind-specific structured detail (nulls omitted client-side)
  detail: Record<string, unknown>
  feedback_class: FeedbackClass
  feedback_reason: string
  feedback_source: 'ai' | 'rules'
  alerts: FeedbackAlert[]
}

const FEEDBACK_CLASS_VALUES: FeedbackClass[] = ['good', 'warning', 'bad', 'none']

const num = (v: bigint | number | null | undefined) => (v == null ? null : Number(v))
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

function countTurns(t: unknown): number {
  if (Array.isArray(t)) return t.length
  if (typeof t === 'string') return t.split('\n').filter(Boolean).length
  return 0
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ALLOWED_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const sp = req.nextUrl.searchParams
  const ref = sp.get('ref')?.trim().toUpperCase() || null
  const kind = sp.get('kind') as Kind | null
  const sentiment = sp.get('sentiment')?.trim() || null
  const feedbackClass = FEEDBACK_CLASS_VALUES.includes(sp.get('class') as FeedbackClass) ? (sp.get('class') as FeedbackClass) : null
  const q = sp.get('q')?.trim() || null
  const from = sp.get('from') ? new Date(sp.get('from')!) : null
  const to = sp.get('to') ? new Date(sp.get('to')! + 'T23:59:59') : null
  const limit = Math.min(Number(sp.get('limit')) || 300, 1000)

  // ── Country scope → allowed ref prefixes ──────────────────────────────────
  const userCountry = session.user.country as OperationCountry | undefined
  const countryOverride = sp.get('country') as OperationCountry | null
  const effectiveCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? (countryOverride && countryOverride !== 'ALL' ? countryOverride : null)
    : (userCountry || null)

  const scoped = countryScope(effectiveCountry)
  const prefixes = scoped ? scoped.map(c => COUNTRY_PREFIX[c]).filter(Boolean) : null

  // Shared where-fragments applied to every table
  const refWhere = ref
    ? { booking_ref: ref }
    : prefixes && prefixes.length
      ? { OR: prefixes.map(p => ({ booking_ref: { startsWith: p } })) }
      : {}
  const dateWhere = (col: 'created_at' | 'call_date') =>
    from || to ? { [col]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}
  const sentimentWhere = sentiment ? { sentiment } : {}
  const search = (fields: string[]) =>
    q ? { OR: fields.map(f => ({ [f]: { contains: q } })) } : {}

  const wants = (k: Kind) => !kind || kind === k

  // refWhere and search both use `OR`, so they must be combined under AND
  // (spreading would clobber the country scope when a search query is present).
  const whereFor = (col: 'created_at', fields: string[]) => ({
    ...sentimentWhere,
    ...dateWhere(col),
    AND: [refWhere, search(fields)],
  })

  // ── Query the three tables in parallel ────────────────────────────────────
  const [onTour, reconfirm, postTour] = await Promise.all([
    wants('on_tour')
      ? prisma.tbl_te_feedback.findMany({
          where: whereFor('created_at', ['summary', 'highlights', 'issues', 'booking_ref']),
          orderBy: { created_at: 'desc' },
          take: limit,
        })
      : Promise.resolve([]),
    wants('reconfirm')
      ? prisma.tbl_te_reconfirmation.findMany({
          where: whereFor('created_at', ['summary', 'notes', 'requested_change', 'special_requests', 'booking_ref']),
          orderBy: { created_at: 'desc' },
          take: limit,
        })
      : Promise.resolve([]),
    wants('post_tour')
      ? prisma.tbl_te_post_tour.findMany({
          where: whereFor('created_at', ['summary', 'comment', 'best_moment', 'improvements', 'booking_ref']),
          orderBy: { created_at: 'desc' },
          take: limit,
        })
      : Promise.resolve([]),
  ])

  // ── Enrich with customer / lead names and the alerts each call raised ─────
  const all = [...onTour, ...reconfirm, ...postTour]
  const refs = Array.from(new Set(all.map(r => r.booking_ref)))
  const scheduleIds = Array.from(new Set(all.map(r => r.schedule_id).filter((v): v is bigint => v != null)))
  const convIds = Array.from(new Set(all.map(r => r.conversation_id).filter((v): v is string => !!v)))
  const [services, bookings, alertRows] = await Promise.all([
    refs.length
      ? prisma.tbl_te_service.findMany({ where: { booking_ref: { in: refs } }, select: { booking_ref: true, customer_name: true } })
      : Promise.resolve([]),
    refs.length
      ? prisma.booking.findMany({
          where: { bookingRef: { in: refs } },
          select: { bookingRef: true, operationCountry: true, passengers: { where: { isLead: true }, take: 1, select: { name: true } } },
        })
      : Promise.resolve([]),
    scheduleIds.length || convIds.length
      ? prisma.tbl_te_important_alerts.findMany({
          where: { OR: [
            ...(scheduleIds.length ? [{ schedule_id: { in: scheduleIds } }] : []),
            ...(convIds.length ? [{ conversation_id: { in: convIds } }] : []),
          ] },
          select: { schedule_id: true, conversation_id: true, severity: true, category: true, status: true, title: true },
        })
      : Promise.resolve([]),
  ])
  // A scheduled call keys on schedule_id; a test/quick call has none, so it keys on its conversation.
  const alertsBySchedule = new Map<string, FeedbackAlert[]>()
  const alertsByConv = new Map<string, FeedbackAlert[]>()
  for (const a of alertRows) {
    const alert: FeedbackAlert = { severity: a.severity, category: a.category, status: a.status, title: a.title }
    if (a.schedule_id != null) {
      const k = String(a.schedule_id)
      alertsBySchedule.set(k, [...(alertsBySchedule.get(k) ?? []), alert])
    } else if (a.conversation_id) {
      alertsByConv.set(a.conversation_id, [...(alertsByConv.get(a.conversation_id) ?? []), alert])
    }
  }
  const alertsFor = (scheduleId: bigint | null, convId: string | null) =>
    scheduleId != null ? alertsBySchedule.get(String(scheduleId)) ?? [] : convId ? alertsByConv.get(convId) ?? [] : []

  const svcName = new Map(services.map(s => [s.booking_ref, s.customer_name]))
  const bkMeta = new Map(bookings.map(b => [b.bookingRef, { country: b.operationCountry as string, lead: b.passengers[0]?.name ?? null }]))

  const enrich = (ref: string) => ({
    customer_name: svcName.get(ref) ?? null,
    lead_name: bkMeta.get(ref)?.lead ?? null,
    operation_country: bkMeta.get(ref)?.country ?? null,
  })

  // ── Map each table to the unified record shape ────────────────────────────
  type Unclassified = Omit<TranscriptRecord, 'feedback_class' | 'feedback_reason' | 'feedback_source'> & { raw: unknown }
  const unclassified: Unclassified[] = [
    ...onTour.map((r): Unclassified => ({
      uid: `on_tour-${r.id}`, kind: 'on_tour', id: num(r.id)!, service_id: num(r.service_id)!, schedule_id: num(r.schedule_id),
      booking_ref: r.booking_ref, ...enrich(r.booking_ref),
      day_no: r.day_no, call_date: iso(r.call_date), at: iso(r.created_at),
      sentiment: r.sentiment, outcome: null, rating: null, summary: r.summary,
      conversation_id: r.conversation_id, transcript: r.transcript, transcript_turns: countTurns(r.transcript),
      detail: { highlights: r.highlights, issues: r.issues, hotel_ok: r.hotel_ok, meals_ok: r.meals_ok, driver_ok: r.driver_ok, vehicle_ok: r.vehicle_ok },
      raw: r.raw, alerts: alertsFor(r.schedule_id, r.conversation_id),
    })),
    ...reconfirm.map((r): Unclassified => ({
      uid: `reconfirm-${r.id}`, kind: 'reconfirm', id: num(r.id)!, service_id: num(r.service_id)!, schedule_id: num(r.schedule_id),
      booking_ref: r.booking_ref, ...enrich(r.booking_ref),
      day_no: null, call_date: iso(r.created_at), at: iso(r.created_at),
      sentiment: r.sentiment, outcome: r.outcome, rating: null, summary: r.summary,
      conversation_id: r.conversation_id, transcript: r.transcript, transcript_turns: countTurns(r.transcript),
      detail: { dates_ok: r.dates_ok, flight_ok: r.flight_ok, pax_ok: r.pax_ok, contact_ok: r.contact_ok, requested_change: r.requested_change, special_requests: r.special_requests, notes: r.notes },
      raw: r.raw, alerts: alertsFor(r.schedule_id, r.conversation_id),
    })),
    ...postTour.map((r): Unclassified => ({
      uid: `post_tour-${r.id}`, kind: 'post_tour', id: num(r.id)!, service_id: num(r.service_id)!, schedule_id: num(r.schedule_id),
      booking_ref: r.booking_ref, ...enrich(r.booking_ref),
      day_no: null, call_date: iso(r.created_at), at: iso(r.created_at),
      sentiment: r.sentiment, outcome: r.outcome, rating: r.rating, summary: r.summary,
      conversation_id: r.conversation_id, transcript: r.transcript, transcript_turns: countTurns(r.transcript),
      detail: { reached_home_safely: r.reached_home_safely, would_recommend: r.would_recommend, best_moment: r.best_moment, improvements: r.improvements, comment: r.comment },
      raw: r.raw, alerts: alertsFor(r.schedule_id, r.conversation_id),
    })),
  ]

  // ── Sort every call into good / warning / bad (or none) ───────────────────
  // `raw` only feeds the verdict — it carries internal capture args, so it is not sent on.
  const classified: TranscriptRecord[] = unclassified.map(({ raw, ...rec }) => {
    const v = classifyFeedback({
      kind: rec.kind, sentiment: rec.sentiment, outcome: rec.outcome, rating: rec.rating,
      detail: rec.detail, raw, transcriptTurns: rec.transcript_turns, alerts: rec.alerts,
    })
    return { ...rec, feedback_class: v.cls, feedback_reason: v.reason, feedback_source: v.source }
  })
  const records = feedbackClass ? classified.filter(r => r.feedback_class === feedbackClass) : classified

  records.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())
  const sliced = records.slice(0, limit)

  // ── Aggregate stats for the explorer header ───────────────────────────────
  const ratings = sliced.filter(r => r.kind === 'post_tour' && r.rating != null).map(r => r.rating as number)
  const sentimentBreakdown: Record<string, number> = {}
  for (const r of sliced) if (r.sentiment) sentimentBreakdown[r.sentiment] = (sentimentBreakdown[r.sentiment] ?? 0) + 1

  const stats = {
    total: sliced.length,
    byKind: {
      on_tour: sliced.filter(r => r.kind === 'on_tour').length,
      reconfirm: sliced.filter(r => r.kind === 'reconfirm').length,
      post_tour: sliced.filter(r => r.kind === 'post_tour').length,
    },
    withTranscript: sliced.filter(r => r.transcript_turns > 0).length,
    bookings: new Set(sliced.map(r => r.booking_ref)).size,
    avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    sentimentBreakdown,
    classBreakdown: Object.fromEntries(
      FEEDBACK_CLASS_VALUES.map(c => [c, sliced.filter(r => r.feedback_class === c).length]),
    ) as Record<FeedbackClass, number>,
  }

  return buildApiSuccess({ records: sliced, stats })
}
