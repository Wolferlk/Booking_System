/**
 * The Feedbacks collector — reads every feedback channel for a booking and
 * folds them into one `FeedbackDossier`.
 *
 * Read-only by construction: this file contains `findMany`/`findUnique` and
 * nothing else. It is the single entry point for both tabs of the Feedbacks
 * page, the per-booking PDF and the bulk report, so what the screen shows and
 * what the PDF prints can never disagree.
 *
 * Batching matters here. The bulk tab is handed a list of booking refs and
 * would otherwise fire six queries per ref; instead every table is read once
 * with `where … in refs` and the rows are grouped in memory.
 */
import { prisma } from '@/lib/prisma'
import type { OperationCountry } from '@prisma/client'
import {
  type BatchReport, type BatchTotals, type BookingFacts, type CallCheck,
  type CallKind, type CallRecord, type ChannelCoverage, type CheckAnswer,
  type ComplaintRecord, type ContactLogRecord, type DeskNoteRecord,
  type DossierStats, type ExperienceReportRecord, type ExperienceScore,
  type FeedbackDossier, type FeedbackFormRecord, type FormAnswer,
  type HealthBand, type ScheduledCall, type ScoreComponent, type Sentiment,
  type TimelineEvent, type TranscriptLine,
} from './types'

// ─── Small helpers ────────────────────────────────────────────────────────────

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const num = (v: bigint | number | null | undefined) => (v == null ? null : Number(v))
const clean = (v: string | null | undefined) => {
  const s = String(v ?? '').trim()
  return s.length ? s : null
}

/** Refs are stored upper-case; accept whatever the user typed. */
export function normaliseRef(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * The bulk tab takes a paste — a column from a spreadsheet, a comma list, a
 * WhatsApp message. Split on everything anyone plausibly separates refs with,
 * then de-duplicate while keeping the order the user typed.
 */
export function parseRefList(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of String(raw ?? '').split(/[\s,;|\n\r\t]+/)) {
    const ref = normaliseRef(part)
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    out.push(ref)
  }
  return out
}

/** The upstream sentiment vocabulary drifts between call providers. */
export function toSentiment(raw: string | null | undefined): Sentiment {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'unknown'
  if (['positive', 'happy', 'good', 'satisfied', 'delighted', 'very_happy'].includes(s)) return 'positive'
  if (['negative', 'unhappy', 'sad', 'angry', 'bad', 'frustrated', 'upset'].includes(s)) return 'negative'
  if (['neutral', 'mixed', 'ok', 'okay'].includes(s)) return 'neutral'
  return 'unknown'
}

/** `hotel_ok` and friends are free-text varchars; only three answers matter. */
function toCheckAnswer(raw: string | null | undefined): CheckAnswer {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'unclear'
  if (['good', 'yes', 'y', 'ok', 'okay', 'fine', 'excellent', 'great', 'happy', 'true', '1'].includes(s)) return 'good'
  if (['bad', 'no', 'n', 'poor', 'unhappy', 'issue', 'problem', 'false', '0'].includes(s)) return 'bad'
  return 'unclear'
}

function checkOf(label: string, raw: string | null | undefined): CallCheck | null {
  const value = clean(raw)
  if (!value) return null
  return { label, raw: value, answer: toCheckAnswer(value) }
}

function noteOf(label: string, raw: string | null | undefined): { label: string; text: string } | null {
  const text = clean(raw)
  return text ? { label, text } : null
}

/**
 * Transcripts arrive either as a turn array or as one newline blob, and the
 * role vocabulary differs per provider. Fold both into three speakers.
 * (Mirrors `lib/te/experience-report/collect.ts`, kept local so the Feedbacks
 * module has no dependency on the experience-report pipeline.)
 */
export function normaliseTranscript(raw: unknown): TranscriptLine[] {
  if (!raw) return []

  const AGENT = ['ai', 'agent', 'bot', 'assistant']
  const GUEST = ['user', 'customer', 'human', 'passenger', 'caller', 'guest']

  if (Array.isArray(raw)) {
    return (raw as Record<string, string>[])
      .map(turn => {
        const role = String(turn?.role ?? turn?.speaker ?? '').toLowerCase()
        const text = String(turn?.text ?? turn?.message ?? turn?.content ?? '').trim()
        const speaker: TranscriptLine['speaker'] =
          AGENT.includes(role) ? 'agent' : GUEST.includes(role) ? 'customer' : 'system'
        return { speaker, text }
      })
      .filter(l => l.text)
  }

  if (typeof raw === 'object') {
    const inner = (raw as Record<string, unknown>).turns ?? (raw as Record<string, unknown>).messages
    if (Array.isArray(inner)) return normaliseTranscript(inner)
    return []
  }

  return String(raw)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const strip = (s: string) => s.replace(/^[^:]+:\s*/, '')
      if (/^(agent|bot|ai|assistant)\s*:/i.test(line)) return { speaker: 'agent' as const, text: strip(line) }
      if (/^(customer|user|human|guest)\s*:/i.test(line)) return { speaker: 'customer' as const, text: strip(line) }
      return { speaker: 'system' as const, text: line }
    })
    .filter(l => l.text)
}

function nightsBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null
  const ms = b.getTime() - a.getTime()
  if (ms < 0) return null
  return Math.round(ms / 86_400_000)
}

function titleCase(v: string | null | undefined): string | null {
  const s = clean(v)
  return s ? s.charAt(0) + s.slice(1).toLowerCase() : null
}

const RATING_SCORE: Record<string, number> = { EXCELLENT: 4, GOOD: 3, AVERAGE: 2, POOR: 1 }

// ─── Scoring ──────────────────────────────────────────────────────────────────

const SEVERITY_PENALTY: Record<string, number> = { high: 14, medium: 7, low: 3 }

function bandOf(value: number | null): HealthBand {
  if (value == null) return 'unknown'
  if (value >= 85) return 'excellent'
  if (value >= 70) return 'good'
  if (value >= 50) return 'watch'
  return 'at_risk'
}

/**
 * The experience score — a weighted mean of whichever channels actually spoke,
 * then a deduction for complaints that are still open.
 *
 * Weights say how much each channel is worth as evidence. The guest's own form
 * and the post-tour rating are first-hand and weigh most; a desk note is
 * second-hand and weighs least. Channels that produced nothing are skipped
 * entirely rather than scored as zero — silence is not a bad review, which is
 * why a booking with no feedback lands in `unknown` and not in `at_risk`.
 */
function computeScore(
  calls: CallRecord[],
  form: FeedbackFormRecord | null,
  deskNotes: DeskNoteRecord[],
  complaints: ComplaintRecord[],
): ExperienceScore {
  const components: ScoreComponent[] = []
  const reasons: string[] = []

  // Sentiment across every call that expressed one.
  const voiced = calls.filter(c => c.sentiment !== 'unknown')
  if (voiced.length) {
    const map = { positive: 100, neutral: 62, negative: 12, unknown: 0 }
    const value = voiced.reduce((n, c) => n + map[c.sentiment], 0) / voiced.length
    const neg = voiced.filter(c => c.sentiment === 'negative').length
    components.push({
      key: 'sentiment',
      label: 'Call sentiment',
      value,
      weight: 1.4,
      detail: `${voiced.length} call${voiced.length === 1 ? '' : 's'} read${neg ? `, ${neg} negative` : ''}`,
    })
    if (neg) reasons.push(`${neg} call${neg === 1 ? '' : 's'} came back negative.`)
  }

  // Structured yes/no checks the bot asked on the ground.
  const checks = calls.flatMap(c => c.checks).filter(c => c.answer !== 'unclear')
  if (checks.length) {
    const good = checks.filter(c => c.answer === 'good').length
    const value = (good / checks.length) * 100
    components.push({
      key: 'checks',
      label: 'Service checks',
      value,
      weight: 1.2,
      detail: `${good}/${checks.length} answered well`,
    })
    const bad = checks.length - good
    if (bad) {
      const which = Array.from(new Set(checks.filter(c => c.answer === 'bad').map(c => c.label))).join(', ')
      reasons.push(`Flagged on the ground: ${which}.`)
    }
  }

  // The guest's own form.
  if (form?.scorePct != null) {
    components.push({
      key: 'form',
      label: 'Feedback form',
      value: form.scorePct,
      weight: 1.6,
      detail: `${form.answers.filter(a => a.score != null).length} question${form.answers.filter(a => a.score != null).length === 1 ? '' : 's'} answered`,
    })
    if (form.scorePct < 55) reasons.push('The guest scored the feedback form poorly.')
  }

  // Post-tour 0–10 rating.
  const rated = calls.filter(c => c.kind === 'post_tour' && c.rating != null)
  if (rated.length) {
    const avg = rated.reduce((n, c) => n + (c.rating as number), 0) / rated.length
    components.push({
      key: 'post_tour',
      label: 'Post-tour rating',
      value: Math.max(0, Math.min(100, avg * 10)),
      weight: 1.6,
      detail: `${avg.toFixed(1)} / 10`,
    })
    if (avg <= 6) reasons.push(`Post-tour rating was ${avg.toFixed(1)}/10.`)
  }

  // The desk's own saved rating (1–5).
  const desk = deskNotes.filter(d => d.rating != null)
  if (desk.length) {
    const avg = desk.reduce((n, d) => n + (d.rating as number), 0) / desk.length
    components.push({
      key: 'desk',
      label: 'Desk rating',
      value: Math.max(0, Math.min(100, avg * 20)),
      weight: 0.8,
      detail: `${avg.toFixed(1)} / 5 saved by the team`,
    })
  }

  if (!components.length) {
    return { value: null, band: 'unknown', components, complaintPenalty: 0, reasons: ['No feedback has been captured for this booking yet.'] }
  }

  const weighted = components.reduce((n, c) => n + c.value * c.weight, 0)
  const weight = components.reduce((n, c) => n + c.weight, 0)
  const base = weighted / weight

  const open = complaints.filter(c => c.isOpen)
  const complaintPenalty = Math.min(45, open.reduce((n, c) => n + (SEVERITY_PENALTY[c.severity] ?? 5), 0))
  if (open.length) {
    const high = open.filter(c => c.severity === 'high').length
    reasons.push(
      `${open.length} complaint${open.length === 1 ? '' : 's'} still open${high ? ` (${high} high severity)` : ''}.`,
    )
  }

  const value = Math.max(0, Math.min(100, Math.round(base - complaintPenalty)))
  if (!reasons.length) reasons.push('Every channel that spoke came back clean.')

  return { value, band: bandOf(value), components, complaintPenalty, reasons }
}

// ─── Row → record mappers ─────────────────────────────────────────────────────

type ReconfirmRow = Awaited<ReturnType<typeof prisma.tbl_te_reconfirmation.findMany>>[number]
type OnGroundRow = Awaited<ReturnType<typeof prisma.tbl_te_feedback.findMany>>[number]
type PostTourRow = Awaited<ReturnType<typeof prisma.tbl_te_post_tour.findMany>>[number]
type AlertRow = Awaited<ReturnType<typeof prisma.tbl_te_important_alerts.findMany>>[number]
type ScheduleRow = Awaited<ReturnType<typeof prisma.tbl_te_call_schedule.findMany>>[number]

/**
 * A call row exists as soon as one was attempted, which is not the same as the
 * call having told us anything. A placeholder with no sentiment, no answers, no
 * summary and no transcript does not count as feedback.
 */
function hasSubstance(c: Omit<CallRecord, 'hasSubstance'>): boolean {
  return !!(
    c.rawSentiment || c.summary || c.rating != null ||
    c.notes.length || c.checks.length || c.transcript.length
  )
}

function finishCall(c: Omit<CallRecord, 'hasSubstance'>): CallRecord {
  return { ...c, hasSubstance: hasSubstance(c) }
}

function mapReconfirm(r: ReconfirmRow): CallRecord {
  return finishCall({
    uid: `reconfirm-${r.id}`,
    kind: 'reconfirm',
    id: Number(r.id),
    serviceId: num(r.service_id),
    scheduleId: num(r.schedule_id),
    bookingRef: r.booking_ref,
    dayNo: null,
    at: iso(r.created_at),
    createdAt: iso(r.created_at),
    sentiment: toSentiment(r.sentiment),
    rawSentiment: clean(r.sentiment),
    outcome: clean(r.outcome),
    rating: null,
    summary: clean(r.summary),
    notes: [
      noteOf('Requested change', r.requested_change),
      noteOf('Special requests', r.special_requests),
      noteOf('Notes', r.notes),
    ].filter(Boolean) as { label: string; text: string }[],
    checks: [
      checkOf('Dates', r.dates_ok),
      checkOf('Flight', r.flight_ok),
      checkOf('Pax', r.pax_ok),
      checkOf('Contact', r.contact_ok),
    ].filter(Boolean) as CallCheck[],
    conversationId: clean(r.conversation_id),
    transcript: normaliseTranscript(r.transcript),
  })
}

function mapOnGround(r: OnGroundRow): CallRecord {
  return finishCall({
    uid: `on_ground-${r.id}`,
    kind: 'on_ground',
    id: Number(r.id),
    serviceId: num(r.service_id),
    scheduleId: num(r.schedule_id),
    bookingRef: r.booking_ref,
    dayNo: r.day_no,
    at: iso(r.call_date ?? r.created_at),
    createdAt: iso(r.created_at),
    sentiment: toSentiment(r.sentiment),
    rawSentiment: clean(r.sentiment),
    outcome: null,
    rating: null,
    summary: clean(r.summary),
    notes: [
      noteOf('Highlights', r.highlights),
      noteOf('Issues', r.issues),
    ].filter(Boolean) as { label: string; text: string }[],
    checks: [
      checkOf('Hotel', r.hotel_ok),
      checkOf('Meals', r.meals_ok),
      checkOf('Driver', r.driver_ok),
      checkOf('Vehicle', r.vehicle_ok),
    ].filter(Boolean) as CallCheck[],
    conversationId: clean(r.conversation_id),
    transcript: normaliseTranscript(r.transcript),
  })
}

function mapPostTour(r: PostTourRow): CallRecord {
  const yesNo = (v: boolean | null, label: string) =>
    v == null ? null : { label, text: v ? 'Yes' : 'No' }

  return finishCall({
    uid: `post_tour-${r.id}`,
    kind: 'post_tour',
    id: Number(r.id),
    serviceId: num(r.service_id),
    scheduleId: num(r.schedule_id),
    bookingRef: r.booking_ref,
    dayNo: null,
    at: iso(r.created_at),
    createdAt: iso(r.created_at),
    sentiment: toSentiment(r.sentiment),
    rawSentiment: clean(r.sentiment),
    outcome: clean(r.outcome),
    rating: r.rating,
    summary: clean(r.summary),
    notes: [
      noteOf('Best moment', r.best_moment),
      noteOf('Improvements', r.improvements),
      noteOf('Comment', r.comment),
      yesNo(r.would_recommend, 'Would recommend'),
      yesNo(r.reached_home_safely, 'Reached home safely'),
    ].filter(Boolean) as { label: string; text: string }[],
    checks: [],
    conversationId: clean(r.conversation_id),
    transcript: normaliseTranscript(r.transcript),
  })
}

function mapComplaint(r: AlertRow): ComplaintRecord {
  const severity = (['high', 'medium', 'low'].includes(String(r.severity).toLowerCase())
    ? String(r.severity).toLowerCase()
    : 'medium') as ComplaintRecord['severity']
  const status = String(r.status ?? 'open').toLowerCase()

  return {
    id: Number(r.id),
    bookingRef: clean(r.booking_ref),
    customerName: clean(r.customer_name),
    callKind: clean(r.call_kind),
    category: clean(r.category),
    severity,
    status,
    isOpen: !['resolved', 'closed', 'done', 'dismissed'].includes(status),
    title: clean(r.title),
    details: clean(r.details),
    customerQuote: clean(r.customer_quote),
    sentiment: toSentiment(r.sentiment),
    resolutionNote: clean(r.resolution_note),
    resolvedAt: iso(r.resolved_at),
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
    conversationId: clean(r.conversation_id),
  }
}

function mapSchedule(r: ScheduleRow): ScheduledCall {
  return {
    id: Number(r.id),
    dayNo: r.day_no,
    callDate: iso(r.call_date),
    scheduledAt: iso(r.scheduled_at),
    phase: clean(r.phase),
    status: String(r.status ?? 'pending').toLowerCase(),
    attempts: r.attempts ?? 0,
    error: clean(r.error),
    dayBrief: clean(r.day_brief),
  }
}

const FORM_QUESTIONS: { key: string; label: string }[] = [
  { key: 'accommodationRoom', label: 'Accommodation — room' },
  { key: 'accommodationFood', label: 'Accommodation — food' },
  { key: 'restaurantFood', label: 'Restaurant — food' },
  { key: 'restaurantAmbience', label: 'Restaurant — ambience' },
  { key: 'transportVehicle', label: 'Transport — vehicle' },
  { key: 'transportDriver', label: 'Transport — driver' },
  { key: 'overallExperience', label: 'Overall experience' },
]

function mapForm(gf: {
  id: string
  submittedAt: Date
  clientName: string | null
  purpose: string | null
  remarks: string | null
  [k: string]: unknown
} | null): FeedbackFormRecord | null {
  if (!gf) return null

  const answers: FormAnswer[] = FORM_QUESTIONS.map(q => {
    const raw = gf[q.key] as string | null
    return { label: q.label, value: titleCase(raw), score: raw ? (RATING_SCORE[raw] ?? null) : null }
  })

  const scored = answers.filter(a => a.score != null).map(a => a.score as number)
  // 1–4 mapped onto 0–100 so it sits alongside the other score components.
  const scorePct = scored.length
    ? Math.round(((scored.reduce((a, b) => a + b, 0) / scored.length - 1) / 3) * 100)
    : null

  return {
    id: gf.id,
    submittedAt: gf.submittedAt.toISOString(),
    clientName: clean(gf.clientName),
    purpose: titleCase(gf.purpose),
    answers,
    remarks: clean(gf.remarks),
    scorePct,
  }
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function buildTimeline(d: Omit<FeedbackDossier, 'timeline' | 'collectedAt'>): TimelineEvent[] {
  const events: TimelineEvent[] = []

  for (const c of d.calls) {
    if (!c.at) continue
    const kindLabel = c.kind === 'reconfirm' ? 'Reconfirmation call'
      : c.kind === 'post_tour' ? 'Post-tour call'
      : `On-ground call${c.dayNo != null ? ` — day ${c.dayNo}` : ''}`
    events.push({
      at: c.at,
      kind: 'call',
      title: kindLabel,
      detail: c.summary ?? c.notes[0]?.text ?? c.outcome,
      sentiment: c.sentiment,
      severity: null,
      ref: c.uid,
    })
  }

  if (d.form) {
    events.push({
      at: d.form.submittedAt,
      kind: 'form',
      title: 'Guest feedback form submitted',
      detail: d.form.remarks ?? (d.form.scorePct != null ? `Scored ${d.form.scorePct}%` : null),
      sentiment: d.form.scorePct == null ? 'unknown' : d.form.scorePct >= 70 ? 'positive' : d.form.scorePct >= 45 ? 'neutral' : 'negative',
      severity: null,
      ref: `form-${d.form.id}`,
    })
  }

  for (const n of d.deskNotes) {
    events.push({
      at: n.createdAt,
      kind: 'desk_note',
      title: `Desk note${n.rating != null ? ` — ${n.rating}/5` : ''}`,
      detail: n.comment,
      sentiment: n.rating == null ? 'unknown' : n.rating >= 4 ? 'positive' : n.rating >= 3 ? 'neutral' : 'negative',
      severity: null,
      ref: `desk-${n.id}`,
    })
  }

  for (const c of d.complaints) {
    events.push({
      at: c.createdAt,
      kind: 'complaint',
      title: c.title ?? `Complaint — ${c.category ?? 'general'}`,
      detail: c.details ?? c.customerQuote,
      sentiment: 'negative',
      severity: c.severity,
      ref: `complaint-${c.id}`,
    })
  }

  for (const l of d.contactLogs) {
    events.push({
      at: l.contactedAt,
      kind: 'contact_log',
      title: `${l.type} — ${l.subject}`,
      detail: l.notes,
      sentiment: 'unknown',
      severity: null,
      ref: `contact-${l.id}`,
    })
  }

  for (const r of d.experienceReports) {
    events.push({
      at: r.sentAt ?? r.createdAt,
      kind: 'experience_report',
      title: `Experience report — ${r.status}`,
      detail: r.subject ?? r.holdReason,
      sentiment: r.riskLevel === 'none' ? 'unknown' : 'negative',
      severity: r.riskLevel === 'high' ? 'high' : r.riskLevel === 'none' ? null : 'medium',
      ref: `report-${r.id}`,
    })
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

// ─── Collector ────────────────────────────────────────────────────────────────

export interface CollectOptions {
  /** Country scope from the caller's session; null means "all countries". */
  countries?: OperationCountry[] | null
  /** Transcripts roughly triple the payload; the bulk tab asks for them off. */
  includeTranscripts?: boolean
}

/**
 * Collect dossiers for many refs at once.
 *
 * Every table is read once for the whole batch. `refs` is expected to already be
 * normalised (see `parseRefList`); anything not found comes back in
 * `totals.missing` rather than throwing, because a paste of 200 refs will
 * always contain a typo or two and the report is still worth having.
 */
export async function collectFeedbackBatch(
  refs: string[],
  opts: CollectOptions = {},
): Promise<BatchReport> {
  const wanted = Array.from(new Set(refs.map(normaliseRef).filter(Boolean)))
  const warnings: string[] = []

  if (!wanted.length) {
    return { totals: emptyTotals(0, []), dossiers: [], generatedAt: new Date().toISOString(), warnings: ['No booking references were given.'] }
  }

  const bookingWhere = {
    bookingRef: { in: wanted },
    ...(opts.countries ? { operationCountry: { in: opts.countries } } : {}),
  }

  const bookings = await prisma.booking.findMany({
    where: bookingWhere,
    select: {
      id: true, bookingRef: true, isNumber: true, dealName: true, status: true,
      operationCountry: true, tourDestination: true, agent: true, agentEmail: true,
      fileHandler: true, contactEmail: true, contactPhone: true,
      arrivalDate: true, departureDate: true, specialOccasions: true, languagePreference: true,
      paxAdults: true, paxChildren: true, paxInfants: true,
      passengers: { select: { name: true, type: true, isLead: true } },
      itineraryItems: {
        select: { dayNo: true, date: true, title: true, description: true },
        orderBy: { dayNo: 'asc' },
      },
      guestFeedback: true,
      customerFeedback: { include: { savedBy: { select: { name: true, email: true } } } },
      contactLogs: {
        orderBy: { contactedAt: 'desc' },
        take: 60,
        include: { user: { select: { name: true, email: true } } },
      },
    },
  })

  const found = bookings.map(b => b.bookingRef)
  const foundSet = new Set(found)
  const missing = wanted.filter(r => !foundSet.has(r))

  // Country scope is enforced on the booking read above; every downstream table
  // is then keyed to the refs that survived it, so a scoped user can never pull
  // call rows for another country's booking.
  const refsInScope = found

  const [services, reconfirm, onGround, postTour, alerts, reports] = await Promise.all([
    refsInScope.length
      ? prisma.tbl_te_service.findMany({ where: { booking_ref: { in: refsInScope } } })
      : Promise.resolve([]),
    refsInScope.length
      ? prisma.tbl_te_reconfirmation.findMany({ where: { booking_ref: { in: refsInScope } }, orderBy: { created_at: 'desc' } })
      : Promise.resolve([]),
    refsInScope.length
      ? prisma.tbl_te_feedback.findMany({ where: { booking_ref: { in: refsInScope } }, orderBy: [{ day_no: 'asc' }, { created_at: 'asc' }] })
      : Promise.resolve([]),
    refsInScope.length
      ? prisma.tbl_te_post_tour.findMany({ where: { booking_ref: { in: refsInScope } }, orderBy: { created_at: 'desc' } })
      : Promise.resolve([]),
    refsInScope.length
      ? prisma.tbl_te_important_alerts.findMany({ where: { booking_ref: { in: refsInScope } }, orderBy: { created_at: 'desc' } })
      : Promise.resolve([]),
    refsInScope.length
      ? prisma.teExperienceReport.findMany({ where: { bookingRef: { in: refsInScope } }, orderBy: { createdAt: 'desc' } })
      : Promise.resolve([]),
  ])

  // The call schedule is keyed by service id, not booking ref — resolve it from
  // the services we just read rather than a second pass per booking.
  const serviceIds = services.map(s => s.id)
  const schedules = serviceIds.length
    ? await prisma.tbl_te_call_schedule.findMany({
        where: { service_id: { in: serviceIds } },
        orderBy: [{ call_date: 'asc' }, { day_no: 'asc' }],
      })
    : []

  // ── Group by ref ───────────────────────────────────────────────────────────
  const group = <T,>(rows: T[], key: (r: T) => string | null) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const k = key(r)
      if (!k) continue
      const list = m.get(k)
      if (list) list.push(r)
      else m.set(k, [r])
    }
    return m
  }

  const serviceByRef = new Map(services.map(s => [s.booking_ref, s]))
  const scheduleByService = group(schedules, s => String(s.service_id))
  const reconfirmByRef = group(reconfirm, r => r.booking_ref)
  const onGroundByRef = group(onGround, r => r.booking_ref)
  const postTourByRef = group(postTour, r => r.booking_ref)
  const alertsByRef = group(alerts, r => r.booking_ref)
  const reportsByRef = group(reports, r => r.bookingRef)

  const dossiers: FeedbackDossier[] = bookings.map(b => {
    const ref = b.bookingRef
    const service = serviceByRef.get(ref) ?? null
    const dossierWarnings: string[] = []

    const calls: CallRecord[] = [
      ...(reconfirmByRef.get(ref) ?? []).map(mapReconfirm),
      ...(onGroundByRef.get(ref) ?? []).map(mapOnGround),
      ...(postTourByRef.get(ref) ?? []).map(mapPostTour),
    ]
    if (!opts.includeTranscripts) for (const c of calls) c.transcript = []

    const schedule = (service ? scheduleByService.get(String(service.id)) ?? [] : []).map(mapSchedule)
    const complaints = (alertsByRef.get(ref) ?? []).map(mapComplaint)
    const form = mapForm(b.guestFeedback as never)

    const deskNotes: DeskNoteRecord[] = b.customerFeedback
      ? [{
          id: b.customerFeedback.id,
          rating: b.customerFeedback.rating,
          comment: clean(b.customerFeedback.comment),
          savedBy: b.customerFeedback.savedBy?.name ?? b.customerFeedback.savedBy?.email ?? null,
          createdAt: b.customerFeedback.createdAt.toISOString(),
          updatedAt: b.customerFeedback.updatedAt.toISOString(),
        }]
      : []

    const contactLogs: ContactLogRecord[] = b.contactLogs.map(l => ({
      id: l.id,
      type: l.type,
      subject: l.subject,
      notes: clean(l.notes),
      contactedAt: l.contactedAt.toISOString(),
      by: l.user?.name ?? l.user?.email ?? null,
    }))

    const experienceReports: ExperienceReportRecord[] = (reportsByRef.get(ref) ?? []).map(r => ({
      id: r.id,
      status: r.status,
      riskLevel: r.riskLevel,
      riskScore: r.riskScore,
      holdReason: clean(r.holdReason),
      subject: clean(r.subject),
      toEmail: clean(r.toEmail),
      sentAt: iso(r.sentAt),
      sentBy: clean(r.sentBy),
      createdAt: r.createdAt.toISOString(),
    }))

    if (!service) dossierWarnings.push('This booking is not registered for AI voice calls.')
    if (!calls.length && !form && !deskNotes.length) dossierWarnings.push('No feedback has been captured through any channel.')

    const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0] ?? null

    const facts: BookingFacts = {
      id: b.id,
      bookingRef: ref,
      isNumber: clean(b.isNumber),
      dealName: clean(b.dealName),
      status: b.status,
      operationCountry: b.operationCountry,
      tourDestination: clean(b.tourDestination),
      agent: clean(b.agent),
      agentEmail: clean(b.agentEmail),
      fileHandler: clean(b.fileHandler),
      contactEmail: clean(b.contactEmail),
      contactPhone: clean(b.contactPhone),
      // The call bot's own record of who it spoke to wins — it is the name the
      // guest answered to — then the lead passenger, then the form.
      clientName: clean(service?.customer_name) ?? lead?.name ?? form?.clientName ?? null,
      leadPassenger: lead?.name ?? null,
      passengers: b.passengers.map(p => ({ name: p.name, type: String(p.type), isLead: p.isLead })),
      pax: {
        adults: b.paxAdults,
        children: b.paxChildren,
        infants: b.paxInfants,
        total: b.paxAdults + b.paxChildren + b.paxInfants,
      },
      arrivalDate: iso(b.arrivalDate),
      departureDate: iso(b.departureDate),
      nights: nightsBetween(b.arrivalDate, b.departureDate),
      specialOccasions: clean(b.specialOccasions),
      languagePreference: clean(b.languagePreference),
      callService: service
        ? {
            id: Number(service.id),
            status: service.status,
            callPhone: clean(service.call_phone ?? service.customer_phone),
            callTime: clean(service.call_time),
            reconfirmEnabled: service.reconfirm_enabled,
            postTourEnabled: service.post_tour_enabled,
            registeredAt: iso(service.created_at),
          }
        : null,
    }

    const substantive = calls.filter(c => c.hasSubstance)
    const coverage: ChannelCoverage = {
      reconfirmCall: substantive.some(c => c.kind === 'reconfirm'),
      onGroundCall: substantive.some(c => c.kind === 'on_ground'),
      postTourCall: substantive.some(c => c.kind === 'post_tour'),
      guestForm: !!form,
      deskNote: deskNotes.length > 0,
      complaints: complaints.length > 0,
      count: 0,
    }
    coverage.count = [coverage.reconfirmCall, coverage.onGroundCall, coverage.postTourCall, coverage.guestForm, coverage.deskNote].filter(Boolean).length

    const allChecks = calls.flatMap(c => c.checks)
    const post = calls.find(c => c.kind === 'post_tour' && c.rating != null)
    const postAny = calls.find(c => c.kind === 'post_tour')

    const stats: DossierStats = {
      callsScheduled: schedule.length,
      callsCompleted: schedule.filter(s => ['done', 'answered', 'completed', 'success'].includes(s.status)).length,
      callsMissed: schedule.filter(s => ['missed', 'failed', 'no_answer', 'error'].includes(s.status)).length,
      callsPending: schedule.filter(s => ['pending', 'scheduled', 'queued', 'retry'].includes(s.status)).length,
      callsLogged: calls.length,
      byKind: {
        reconfirm: calls.filter(c => c.kind === 'reconfirm').length,
        on_ground: calls.filter(c => c.kind === 'on_ground').length,
        post_tour: calls.filter(c => c.kind === 'post_tour').length,
      },
      sentiment: {
        positive: calls.filter(c => c.sentiment === 'positive').length,
        neutral: calls.filter(c => c.sentiment === 'neutral').length,
        negative: calls.filter(c => c.sentiment === 'negative').length,
        unknown: calls.filter(c => c.sentiment === 'unknown').length,
      },
      transcriptTurns: calls.reduce((n, c) => n + c.transcript.length, 0),
      goodChecks: allChecks.filter(c => c.answer === 'good').length,
      badChecks: allChecks.filter(c => c.answer === 'bad').length,
      complaintsOpen: complaints.filter(c => c.isOpen).length,
      complaintsTotal: complaints.length,
      complaintsHigh: complaints.filter(c => c.severity === 'high').length,
      npsRating: post?.rating ?? null,
      wouldRecommend: postAny ? readYesNo(postAny, 'Would recommend') : null,
      reachedHomeSafely: postAny ? readYesNo(postAny, 'Reached home safely') : null,
    }

    const core = {
      facts,
      score: computeScore(calls, form, deskNotes, complaints),
      coverage,
      stats,
      calls,
      schedule,
      form,
      deskNotes,
      complaints,
      contactLogs,
      experienceReports,
      itinerary: b.itineraryItems.map(i => ({
        dayNo: i.dayNo,
        date: iso(i.date)?.slice(0, 10) ?? null,
        title: i.title,
        description: clean(i.description),
      })),
      warnings: dossierWarnings,
    }

    return { ...core, timeline: buildTimeline(core), collectedAt: new Date().toISOString() }
  })

  // Preserve the order the caller asked in — a pasted list is usually already
  // sorted the way the team wants to read it.
  const order = new Map(wanted.map((r, i) => [r, i]))
  dossiers.sort((a, b) => (order.get(a.facts.bookingRef) ?? 0) - (order.get(b.facts.bookingRef) ?? 0))

  if (missing.length) {
    warnings.push(
      `${missing.length} reference${missing.length === 1 ? '' : 's'} did not match a booking you can see: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ` +${missing.length - 12} more` : ''}`,
    )
  }

  return {
    totals: summarise(wanted.length, missing, dossiers),
    dossiers,
    generatedAt: new Date().toISOString(),
    warnings,
  }
}

/** Post-tour booleans are stored as notes once mapped; read them back out. */
function readYesNo(call: CallRecord, label: string): boolean | null {
  const note = call.notes.find(n => n.label === label)
  if (!note) return null
  return note.text.toLowerCase() === 'yes'
}

/** One booking — the single-booking tab and its PDF. */
export async function collectFeedbackDossier(
  ref: string,
  opts: CollectOptions = {},
): Promise<FeedbackDossier | null> {
  const batch = await collectFeedbackBatch([ref], { ...opts, includeTranscripts: opts.includeTranscripts ?? true })
  return batch.dossiers[0] ?? null
}

// ─── Batch roll-up ────────────────────────────────────────────────────────────

function emptyTotals(requested: number, missing: string[]): BatchTotals {
  return {
    requested,
    found: 0,
    missing,
    withAnyFeedback: 0,
    withNoFeedback: 0,
    avgScore: null,
    band: { excellent: 0, good: 0, watch: 0, at_risk: 0, unknown: 0 },
    calls: { logged: 0, scheduled: 0, completed: 0, missed: 0 },
    byKind: { reconfirm: 0, on_ground: 0, post_tour: 0 },
    sentiment: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
    forms: 0,
    deskNotes: 0,
    complaints: { total: 0, open: 0, high: 0 },
    npsAverage: null,
    promoters: 0,
    detractors: 0,
    recommendYes: 0,
    recommendNo: 0,
    coverage: { reconfirmCall: 0, onGroundCall: 0, postTourCall: 0, guestForm: 0, deskNote: 0 },
    topComplaintCategories: [],
    attention: [],
  }
}

function summarise(requested: number, missing: string[], dossiers: FeedbackDossier[]): BatchTotals {
  const t = emptyTotals(requested, missing)
  t.found = dossiers.length

  const categories = new Map<string, { count: number; open: number }>()
  const ratings: number[] = []

  for (const d of dossiers) {
    t.band[d.score.band] += 1
    if (d.coverage.count > 0) t.withAnyFeedback += 1
    else t.withNoFeedback += 1

    t.calls.logged += d.stats.callsLogged
    t.calls.scheduled += d.stats.callsScheduled
    t.calls.completed += d.stats.callsCompleted
    t.calls.missed += d.stats.callsMissed

    for (const k of ['reconfirm', 'on_ground', 'post_tour'] as CallKind[]) t.byKind[k] += d.stats.byKind[k]
    for (const s of ['positive', 'neutral', 'negative', 'unknown'] as const) t.sentiment[s] += d.stats.sentiment[s]

    if (d.form) t.forms += 1
    t.deskNotes += d.deskNotes.length

    t.complaints.total += d.stats.complaintsTotal
    t.complaints.open += d.stats.complaintsOpen
    t.complaints.high += d.stats.complaintsHigh

    for (const c of d.complaints) {
      const key = c.category ?? 'uncategorised'
      const entry = categories.get(key) ?? { count: 0, open: 0 }
      entry.count += 1
      if (c.isOpen) entry.open += 1
      categories.set(key, entry)
    }

    if (d.stats.npsRating != null) {
      ratings.push(d.stats.npsRating)
      if (d.stats.npsRating >= 9) t.promoters += 1
      else if (d.stats.npsRating <= 6) t.detractors += 1
    }
    if (d.stats.wouldRecommend === true) t.recommendYes += 1
    if (d.stats.wouldRecommend === false) t.recommendNo += 1

    if (d.coverage.reconfirmCall) t.coverage.reconfirmCall += 1
    if (d.coverage.onGroundCall) t.coverage.onGroundCall += 1
    if (d.coverage.postTourCall) t.coverage.postTourCall += 1
    if (d.coverage.guestForm) t.coverage.guestForm += 1
    if (d.coverage.deskNote) t.coverage.deskNote += 1
  }

  const scored = dossiers.map(d => d.score.value).filter((v): v is number => v != null)
  t.avgScore = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null
  t.npsAverage = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null

  t.topComplaintCategories = Array.from(categories.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.count - a.count || b.open - a.open)
    .slice(0, 8)

  // Worst first, and only what actually needs a human: anything scored below
  // "good", plus anything carrying an open complaint whatever it scored.
  t.attention = dossiers
    .filter(d => (d.score.value != null && d.score.value < 70) || d.stats.complaintsOpen > 0)
    .sort((a, b) => {
      if (b.stats.complaintsOpen !== a.stats.complaintsOpen) return b.stats.complaintsOpen - a.stats.complaintsOpen
      return (a.score.value ?? 101) - (b.score.value ?? 101)
    })
    .slice(0, 40)
    .map(d => ({
      bookingRef: d.facts.bookingRef,
      clientName: d.facts.clientName,
      score: d.score.value,
      band: d.score.band,
      reason: d.score.reasons[0] ?? 'Needs review.',
    }))

  return t
}
