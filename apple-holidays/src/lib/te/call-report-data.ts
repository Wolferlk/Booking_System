/**
 * The AI voice-call report — one data model behind the dashboard page, the CSV
 * download and the emailed daily report.
 *
 * Everything is derived from the voice service's own tables, which live in the
 * ops database and are read here directly (read-only):
 *   • `tbl_te_call_schedule` — the backbone: an "assigned call" is a schedule
 *                              row, whether or not it ran
 *   • `tbl_te_service`       — one per booking registered for AI calls
 *   • `tbl_te_reconfirmation` / `tbl_te_feedback` / `tbl_te_post_tour`
 *                            — what each call that connected actually captured
 *   • `tbl_te_important_alerts` — complaints / urgent asks raised on a call
 *
 * The upstream HTTP lists are the fallback only: every one of them is capped
 * (services 500, call log 500, schedule 2000, all oldest- or newest-first with
 * no date filter), which is how a three-month window once showed 9 calls out of
 * several thousand. When the database read fails the API is used and the page
 * says the figures may be partial.
 *
 * Call phases are named the way ops speaks about them rather than the way the
 * upstream stores them: a `reconfirm` schedule row is a **pre-tour** call, a
 * plain day row is **on-tour**, and `post_tour` stays as it is.
 */
import {
  APPROVAL_LABEL, getApprovalLedger, resolveApprovalState,
  type ApprovalEntry, type ApprovalState,
} from './call-approvals'
import { classifyFeedback, type FeedbackClass } from './feedback-class'
import { normalizePhone, teGet, teList } from './te-api'
import { prisma } from '@/lib/prisma'
import { toSentiment } from '@/lib/feedbacks/collect'
import { dateInTz, DEFAULT_REPORT_TZ, formatReportDate, shiftDate } from '@/lib/reports/report-window'

// ─── Upstream shapes (only the fields the report reads) ───────────────────────

interface RawScheduleItem {
  id: number
  service_id?: number | null
  booking_ref?: string | null
  call_date: string
  scheduled_at?: string | null
  day_no?: number | null
  phase?: string | null
  day_brief?: string | null
  status: string
  attempts?: number | null
  last_attempt_at?: string | null
  next_attempt_at?: string | null
  error?: string | null
}

interface RawService {
  id: number
  booking_ref: string
  status?: string | null
  customer_name?: string | null
  call_phone?: string | null
  call_time?: string | null
  schedule_mode?: string | null
  created_at?: string | null
  registered_at?: string | null
  /** Local registration day, when the reader already knows it (database path). */
  assigned_on?: string | null
  schedule?: RawScheduleItem[] | null
}

interface RawCall {
  kind?: string | null
  id: number
  booking_ref?: string | null
  schedule_id?: number | null
  conversation_id?: string | null
  sentiment?: string | null
  outcome?: string | null
  summary?: string | null
  at?: string | null
}

interface RawAlert {
  id: number
  service_id?: number | null
  schedule_id?: number | null
  booking_ref?: string | null
  conversation_id?: string | null
  call_kind?: string | null
  severity?: string | null
  status?: string | null
  category?: string | null
  title?: string | null
  details?: string | null
  customer_quote?: string | null
  at?: string | null
  created_at?: string | null
}

// ─── Report model ─────────────────────────────────────────────────────────────

export type CallPhase = 'pre_tour' | 'on_tour' | 'post_tour'

export const CALL_PHASES: CallPhase[] = ['pre_tour', 'on_tour', 'post_tour']

export const PHASE_LABEL: Record<CallPhase, string> = {
  pre_tour: 'Pre-tour',
  on_tour: 'On-tour',
  post_tour: 'Post-tour',
}

/** `day` and `month` filter on the call date; `assign_day` on the registration date. */
export type CallReportScope = 'day' | 'month' | 'range' | 'assign_day'

export interface CallReportFilters {
  scope: CallReportScope
  /** yyyy-mm-dd — used by `day` and `assign_day`. */
  date?: string
  /** yyyy-mm — used by `month`. */
  month?: string
  /** yyyy-mm-dd — used by `range`. */
  from?: string
  to?: string
  timezone?: string
  /** Free-text match on booking ref, customer name or phone. */
  search?: string
  /** Only bookings carrying an open alert. */
  onlyUrgent?: boolean
  phase?: CallPhase | 'all'
}

export interface CallCounts {
  assigned: number
  done: number
  pending: number
  missed: number
  skipped: number
}

export type CallDoneState = 'done' | 'partial' | 'not_done'

export interface UrgentSummary {
  open: number
  total: number
  severity: 'high' | 'medium' | 'low' | null
  latestTitle: string | null
}

export interface CallReportRow {
  bookingRef: string
  customerName: string | null
  phone: string | null
  serviceStatus: string
  /** Local date the booking was registered for AI calls ("assign day"). */
  assignedOn: string | null
  counts: CallCounts
  byPhase: Record<CallPhase, CallCounts>
  callDone: CallDoneState
  approval: ApprovalState
  approvalLabel: string
  approvalRequestedAt: string | null
  urgent: UrgentSummary
  lastCallAt: string | null
  nextCallAt: string | null
  lastOutcome: string | null
  lastSentiment: string | null
  /** How the calls in the window went, from the good / warning / bad sort. */
  feedback: { worst: FeedbackClass | null; good: number; warning: number; bad: number }
}

export interface DailyBreakdownRow {
  date: string
  all: number
  pre_tour: number
  on_tour: number
  post_tour: number
  done: number
  pending: number
  missed: number
}

export interface CallReportTotals {
  bookings: number
  calls: CallCounts
  byPhase: Record<CallPhase, CallCounts>
  approval: Record<ApprovalState, number>
  urgentBookings: number
  openAlerts: number
  bookingsFullyCalled: number
  bookingsNotCalled: number
  /** done ÷ assigned, 0–100. */
  completionRate: number
}

export interface CallReportWindow {
  scope: CallReportScope
  fromDate: string
  toDate: string
  timezone: string
  today: string
  label: string
}

export type IssueLevel = 'bad' | 'warning'

/** One thing ops should look at: a call that went badly, or an alert it raised. */
export interface CallIssue {
  id: string
  phase: CallPhase
  level: IssueLevel
  source: 'call' | 'alert'
  bookingRef: string
  customerName: string | null
  phone: string | null
  /** Local call day. */
  date: string | null
  at: string | null
  reason: string
  detail: string | null
  verdictBy: 'ai' | 'rules' | 'alert'
  alert: { severity: string | null; category: string | null; status: string | null } | null
}

export interface VerdictCounts { calls: number; good: number; warning: number; bad: number; none: number }

export type CheckArea = 'hotel' | 'meals' | 'driver' | 'vehicle'

export interface CallInsights {
  /** Calls that reached a result table, sorted good / warning / bad / none. */
  verdicts: Record<CallPhase, VerdictCounts>
  reconfirm: {
    calls: number
    confirmed: number
    changeRequested: number
    specialRequests: number
    mismatched: { dates: number; flight: number; pax: number; contact: number }
  }
  onTour: {
    calls: number
    sentiment: { positive: number; neutral: number; negative: number; unknown: number }
    areas: Record<CheckArea, { good: number; bad: number; unclear: number }>
  }
  postTour: {
    calls: number
    rated: number
    /** Out of 10. */
    avgRating: number | null
    promoters: number
    passives: number
    detractors: number
    nps: number | null
    recommendYes: number
    recommendNo: number
    notHomeSafely: number
  }
  alerts: {
    total: number; open: number; ack: number; resolved: number
    high: number; medium: number; low: number
    byCategory: { category: string; count: number }[]
  }
  /** Operational warnings — calls that will not, or did not, happen. */
  ops: {
    overdue: number
    overdueBookings: number
    neverReached: number
    notApprovedWithPending: number
    failures: { reason: string; count: number }[]
  }
  issues: CallIssue[]
  issueTotals: { bad: number; warning: number; shown: number }
}

export interface CallReportData {
  window: CallReportWindow
  filters: CallReportFilters
  totals: CallReportTotals
  rows: CallReportRow[]
  daily: DailyBreakdownRow[]
  insights: CallInsights
  /** `database` reads every row; `api` is the capped fallback. */
  source: 'database' | 'api'
  generatedAt: string
  /** Upstream lists that failed, so the UI can say the numbers are partial. */
  warnings: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The upstream list endpoints silently cap **every** query at this many rows,
 * whatever `limit` asks for. Only `/schedule` is big enough to hit it today.
 *
 * It answers oldest-first and honours neither `offset`/`page` nor any date
 * filter, so a single wide read returns the oldest slice and the most recent
 * days come back empty — which is exactly how the report lost its last days.
 * The only filters it does honour are `status` and `service_id`.
 */
const UPSTREAM_PAGE_CAP = 2000

/**
 * Every status the upstream scheduler actually writes. Splitting the read by
 * status keeps each slice under the cap and so reaches today's rows.
 *
 * A value the upstream does not recognise is ignored rather than rejected — the
 * query then answers with the unfiltered oldest slice — so this list must hold
 * only real statuses, and each slice is re-checked against its status below.
 */
const SCHEDULE_STATUSES = [
  'pending', 'calling', 'answered', 'done', 'no_answer', 'missed', 'failed', 'skipped',
] as const

const DONE_STATUSES = new Set(['answered', 'done', 'completed'])
// `no_answer` is an attempt that nobody picked up — a missed call, not a call
// still waiting to be made.
const MISSED_STATUSES = new Set(['missed', 'failed', 'no_answer'])
const SKIPPED_STATUSES = new Set(['skipped', 'cancelled'])

function emptyCounts(): CallCounts {
  return { assigned: 0, done: 0, pending: 0, missed: 0, skipped: 0 }
}

function emptyPhaseCounts(): Record<CallPhase, CallCounts> {
  return { pre_tour: emptyCounts(), on_tour: emptyCounts(), post_tour: emptyCounts() }
}

function addStatus(counts: CallCounts, status: string): void {
  counts.assigned++
  const s = status.toLowerCase()
  if (DONE_STATUSES.has(s)) counts.done++
  else if (MISSED_STATUSES.has(s)) counts.missed++
  else if (SKIPPED_STATUSES.has(s)) counts.skipped++
  else counts.pending++
}

function mergeCounts(target: CallCounts, add: CallCounts): void {
  target.assigned += add.assigned
  target.done += add.done
  target.pending += add.pending
  target.missed += add.missed
  target.skipped += add.skipped
}

export function phaseOf(item: { phase?: string | null }): CallPhase {
  const p = (item.phase ?? '').toLowerCase()
  if (p === 'reconfirm' || p === 'pre_tour' || p === 'reconfirmation') return 'pre_tour'
  if (p === 'post_tour' || p === 'posttour') return 'post_tour'
  return 'on_tour'
}

/** `call_date` may arrive as a date or a full timestamp; the report wants the date. */
function dayOf(value: string | null | undefined): string | null {
  if (!value) return null
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

function severityRank(s: string | null | undefined): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : s === 'low' ? 1 : 0
}

function listDates(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  // Bounded so a bad filter can never spin: a report never spans a year.
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur)
    cur = shiftDate(cur, 1)
  }
  return out
}

// ─── Window ───────────────────────────────────────────────────────────────────

export function buildCallReportWindow(f: CallReportFilters, now: Date = new Date()): CallReportWindow {
  const timezone = f.timezone || DEFAULT_REPORT_TZ
  const today = dateInTz(now, timezone)

  let fromDate: string
  let toDate: string
  let label: string

  if (f.scope === 'month') {
    const month = /^\d{4}-\d{2}$/.test(f.month ?? '') ? (f.month as string) : today.slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    fromDate = `${month}-01`
    toDate = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
    label = `${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(y, m - 1, 1)))} — calls by date`
  } else if (f.scope === 'range') {
    fromDate = dayOf(f.from) ?? today
    toDate = dayOf(f.to) ?? fromDate
    if (toDate < fromDate) [fromDate, toDate] = [toDate, fromDate]
    label = `${formatReportDate(fromDate)} → ${formatReportDate(toDate)}`
  } else if (f.scope === 'assign_day') {
    fromDate = toDate = dayOf(f.date) ?? today
    label = `Assigned on ${formatReportDate(fromDate, { weekday: true })}`
  } else {
    fromDate = toDate = dayOf(f.date) ?? today
    const suffix = fromDate === today ? ' (today)' : fromDate === shiftDate(today, -1) ? ' (yesterday)' : ''
    label = `${formatReportDate(fromDate, { weekday: true })}${suffix}`
  }

  return { scope: f.scope, fromDate, toDate, timezone, today, label }
}

// ─── Collection ───────────────────────────────────────────────────────────────

/** A call that reached a result table — one reconfirmation, check-in or post-tour row. */
interface CallResult {
  phase: CallPhase
  id: string
  serviceId: number | null
  scheduleId: number | null
  bookingRef: string
  conversationId: string | null
  at: string | null
  sentiment: string | null
  outcome: string | null
  summary: string | null
  rating: number | null
  detail: Record<string, unknown>
  raw: unknown
}

interface ReportSource {
  source: 'database' | 'api'
  services: RawService[]
  schedule: RawScheduleItem[]
  results: CallResult[]
  alerts: RawAlert[]
  /** Services with a call that ever connected — proof the number is approved. */
  connectedServices: Set<number>
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && !['none', 'null', 'n/a', '-'].includes(s.toLowerCase()) ? s : null
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

/** Prisma hands `@db.Date` back as UTC midnight. */
function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

const IN_CHUNK = 2000

/** Keeps `IN (…)` lists well under MySQL's placeholder limit on wide windows. */
async function inChunks<K, T>(keys: K[], fn: (chunk: K[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < keys.length; i += IN_CHUNK) out.push(...await fn(keys.slice(i, i + IN_CHUNK)))
  return out
}

// ── Database (primary) ──

const SERVICE_SELECT = {
  id: true, booking_ref: true, status: true, customer_name: true, call_phone: true,
  customer_phone: true, call_time: true, schedule_mode: true, created_at: true,
} as const

const SCHEDULE_SELECT = {
  id: true, service_id: true, booking_ref: true, call_date: true, scheduled_at: true, day_no: true,
  phase: true, status: true, attempts: true, last_attempt_at: true, next_attempt_at: true,
  conversation_id: true, error: true,
} as const

/**
 * Every row the window needs, straight from the tables. Reads only — nothing
 * here writes to the database.
 */
async function loadFromDatabase(window: CallReportWindow, scope: CallReportScope): Promise<ReportSource> {
  // A local day can start up to 14h either side of UTC midnight: read a day
  // wider on timestamps and trim on the local date.
  const wideFrom = utcDay(shiftDate(window.fromDate, -1))
  const wideTo = utcDay(shiftDate(window.toDate, 2))
  const inWindow = (d: Date) => {
    const day = dateInTz(d, window.timezone)
    return day >= window.fromDate && day <= window.toDate
  }

  let svcRows: { id: bigint; booking_ref: string; status: string; customer_name: string | null; call_phone: string | null; customer_phone: string | null; call_time: string; schedule_mode: string; created_at: Date }[]
  let schedRows: { id: bigint; service_id: bigint; booking_ref: string; call_date: Date; scheduled_at: Date | null; day_no: number; phase: string | null; status: string; attempts: number; last_attempt_at: Date | null; next_attempt_at: Date | null; conversation_id: string | null; error: string | null }[]

  if (scope === 'assign_day') {
    svcRows = (await prisma.tbl_te_service.findMany({
      where: { created_at: { gte: wideFrom, lt: wideTo } },
      select: SERVICE_SELECT,
    })).filter(s => inWindow(s.created_at))
    schedRows = await inChunks(svcRows.map(s => s.id), chunk => prisma.tbl_te_call_schedule.findMany({
      where: { service_id: { in: chunk } },
      select: SCHEDULE_SELECT,
    }))
  } else {
    schedRows = await prisma.tbl_te_call_schedule.findMany({
      where: { call_date: { gte: utcDay(window.fromDate), lte: utcDay(window.toDate) } },
      select: SCHEDULE_SELECT,
    })
    const ids = Array.from(new Set(schedRows.map(r => r.service_id)))
    svcRows = await inChunks(ids, chunk => prisma.tbl_te_service.findMany({
      where: { id: { in: chunk } },
      select: SERVICE_SELECT,
    }))
  }

  const serviceIds = Array.from(new Set([...svcRows.map(s => s.id), ...schedRows.map(r => r.service_id)]))
  const scheduleIds = schedRows.map(r => r.id)
  const refs = Array.from(new Set([...svcRows.map(s => s.booking_ref), ...schedRows.map(r => r.booking_ref)]))

  // Calls placed outside the schedule ("Call now", tests) carry no schedule id:
  // they count when they happened inside the window.
  const unscheduledOk = (d: Date) => scope === 'assign_day' || inWindow(d)
  const bySchedule = (chunk: bigint[]) => ({ schedule_id: { in: chunk } })
  const unscheduled = (chunk: bigint[]) => ({
    schedule_id: null,
    service_id: { in: chunk },
    ...(scope === 'assign_day' ? {} : { created_at: { gte: wideFrom, lt: wideTo } }),
  })

  const FEEDBACK_SELECT = {
    id: true, service_id: true, schedule_id: true, booking_ref: true, conversation_id: true,
    sentiment: true, highlights: true, hotel_ok: true, meals_ok: true, driver_ok: true, vehicle_ok: true,
    issues: true, summary: true, raw: true, created_at: true,
  } as const
  const RECONFIRM_SELECT = {
    id: true, service_id: true, schedule_id: true, booking_ref: true, conversation_id: true,
    dates_ok: true, flight_ok: true, pax_ok: true, contact_ok: true, requested_change: true,
    special_requests: true, notes: true, outcome: true, sentiment: true, summary: true, raw: true, created_at: true,
  } as const
  const POST_SELECT = {
    id: true, service_id: true, schedule_id: true, booking_ref: true, conversation_id: true,
    rating: true, reached_home_safely: true, would_recommend: true, best_moment: true,
    improvements: true, comment: true, outcome: true, sentiment: true, summary: true, raw: true, created_at: true,
  } as const

  const [fbA, fbB, rcA, rcB, ptA, ptB, alertsBySvc, alertsByRef, connected] = await Promise.all([
    inChunks(scheduleIds, c => prisma.tbl_te_feedback.findMany({ where: bySchedule(c), select: FEEDBACK_SELECT })),
    inChunks(serviceIds, c => prisma.tbl_te_feedback.findMany({ where: unscheduled(c), select: FEEDBACK_SELECT })),
    inChunks(scheduleIds, c => prisma.tbl_te_reconfirmation.findMany({ where: bySchedule(c), select: RECONFIRM_SELECT })),
    inChunks(serviceIds, c => prisma.tbl_te_reconfirmation.findMany({ where: unscheduled(c), select: RECONFIRM_SELECT })),
    inChunks(scheduleIds, c => prisma.tbl_te_post_tour.findMany({ where: bySchedule(c), select: POST_SELECT })),
    inChunks(serviceIds, c => prisma.tbl_te_post_tour.findMany({ where: unscheduled(c), select: POST_SELECT })),
    // Alerts are read for all time: "urgent" is the booking's state now, not
    // only what the window raised.
    inChunks(serviceIds, c => prisma.tbl_te_important_alerts.findMany({ where: { service_id: { in: c } } })),
    inChunks(refs, c => prisma.tbl_te_important_alerts.findMany({ where: { service_id: null, booking_ref: { in: c } } })),
    inChunks(serviceIds, c => prisma.tbl_te_call_schedule.findMany({
      where: {
        service_id: { in: c },
        OR: [{ status: { in: Array.from(DONE_STATUSES) } }, { conversation_id: { not: null } }],
      },
      select: { service_id: true },
      distinct: ['service_id'],
    })),
  ])

  const common = (r: { id: bigint; service_id: bigint; schedule_id: bigint | null; booking_ref: string; conversation_id: string | null; created_at: Date; summary: string | null; sentiment: string | null; raw: unknown }) => ({
    serviceId: Number(r.service_id),
    scheduleId: r.schedule_id != null ? Number(r.schedule_id) : null,
    bookingRef: r.booking_ref.toUpperCase(),
    conversationId: r.conversation_id,
    at: iso(r.created_at),
    sentiment: r.sentiment,
    summary: r.summary,
    raw: r.raw,
  })

  const results: CallResult[] = [
    ...[...fbA, ...fbB.filter(r => unscheduledOk(r.created_at))].map(r => ({
      ...common(r), phase: 'on_tour' as const, id: `on_tour:${r.id}`, rating: null,
      outcome: null,
      detail: {
        hotel_ok: r.hotel_ok, meals_ok: r.meals_ok, driver_ok: r.driver_ok, vehicle_ok: r.vehicle_ok,
        issues: r.issues, highlights: r.highlights,
      },
    })),
    ...[...rcA, ...rcB.filter(r => unscheduledOk(r.created_at))].map(r => ({
      ...common(r), phase: 'pre_tour' as const, id: `pre_tour:${r.id}`, rating: null,
      outcome: r.outcome,
      detail: {
        dates_ok: r.dates_ok, flight_ok: r.flight_ok, pax_ok: r.pax_ok, contact_ok: r.contact_ok,
        requested_change: r.requested_change, special_requests: r.special_requests, notes: r.notes,
      },
    })),
    ...[...ptA, ...ptB.filter(r => unscheduledOk(r.created_at))].map(r => ({
      ...common(r), phase: 'post_tour' as const, id: `post_tour:${r.id}`, rating: r.rating,
      outcome: r.outcome,
      detail: {
        reached_home_safely: r.reached_home_safely, would_recommend: r.would_recommend,
        best_moment: r.best_moment, improvements: r.improvements, comment: r.comment,
      },
    })),
  ]

  const alertSeen = new Set<string>()
  const alerts: RawAlert[] = []
  for (const a of [...alertsBySvc, ...alertsByRef]) {
    const key = String(a.id)
    if (alertSeen.has(key)) continue
    alertSeen.add(key)
    alerts.push({
      id: Number(a.id),
      service_id: a.service_id != null ? Number(a.service_id) : null,
      schedule_id: a.schedule_id != null ? Number(a.schedule_id) : null,
      booking_ref: a.booking_ref,
      conversation_id: a.conversation_id,
      call_kind: a.call_kind,
      severity: a.severity,
      status: a.status,
      category: a.category,
      title: a.title,
      details: a.details,
      customer_quote: a.customer_quote,
      created_at: iso(a.created_at),
    })
  }

  const services: RawService[] = svcRows.map(s => ({
    id: Number(s.id),
    booking_ref: s.booking_ref,
    status: s.status,
    customer_name: s.customer_name,
    call_phone: s.call_phone ?? s.customer_phone,
    call_time: s.call_time,
    schedule_mode: s.schedule_mode,
    created_at: iso(s.created_at),
    assigned_on: dateInTz(s.created_at, window.timezone),
  }))
  // A schedule row whose service row is gone still counts as an assigned call.
  const known = new Set(services.map(s => s.id))
  for (const r of schedRows) {
    const id = Number(r.service_id)
    if (known.has(id)) continue
    known.add(id)
    services.push({ id, booking_ref: r.booking_ref })
  }

  return {
    source: 'database',
    services,
    schedule: schedRows.map(r => ({
      id: Number(r.id),
      service_id: Number(r.service_id),
      booking_ref: r.booking_ref,
      call_date: r.call_date.toISOString().slice(0, 10),
      scheduled_at: iso(r.scheduled_at),
      day_no: r.day_no,
      phase: r.phase,
      status: r.status,
      attempts: r.attempts,
      last_attempt_at: iso(r.last_attempt_at),
      next_attempt_at: iso(r.next_attempt_at),
      error: r.error,
    })),
    results,
    alerts,
    connectedServices: new Set(connected.map(c => Number(c.service_id))),
  }
}

// ── Upstream API (fallback) ──

async function safeList<T>(
  label: string,
  fetcher: () => Promise<unknown>,
  keys: string[],
  warnings: string[],
): Promise<T[]> {
  try {
    return teList<T>(await fetcher(), ...keys)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[CallReport] ${label} unavailable:`, msg)
    warnings.push(`${label} could not be loaded — figures may be incomplete.`)
    return []
  }
}

/** One `/schedule` query; `null` marks a slice that failed rather than an empty one. */
async function scheduleSlice(status: string | null): Promise<RawScheduleItem[] | null> {
  try {
    const payload = await teGet('schedule', { limit: UPSTREAM_PAGE_CAP, status: status ?? undefined })
    return teList<RawScheduleItem>(payload, 'schedule')
  } catch (err) {
    console.warn(`[CallReport] Call schedule (${status ?? 'all'}) unavailable:`,
      err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * The whole call schedule, assembled from one unfiltered read plus one read per
 * status. The unfiltered read is what catches rows carrying a status this file
 * has not been told about; the per-status reads are what reach the recent days.
 * Rows are unioned on `id`, so the overlap between slices costs nothing.
 */
async function fetchSchedule(warnings: string[]): Promise<RawScheduleItem[]> {
  const queries: (string | null)[] = [null, ...SCHEDULE_STATUSES]
  const slices = await Promise.all(queries.map(scheduleSlice))

  const byId = new Map<number, RawScheduleItem>()
  const failed: string[] = []
  const saturated: string[] = []

  slices.forEach((rows, i) => {
    const status = queries[i]
    if (rows === null) { failed.push(status ?? 'all'); return }
    if (rows.length >= UPSTREAM_PAGE_CAP) saturated.push(status ?? 'all')
    for (const row of rows) {
      // Guards against an unrecognised status quietly answering with the
      // unfiltered slice: only rows that really carry it are taken from it.
      if (status && (row.status ?? '').toLowerCase() !== status) continue
      if (row.id != null) byId.set(row.id, row)
    }
  })

  if (failed.length === queries.length) {
    warnings.push('Call schedule could not be loaded — figures may be incomplete.')
  } else if (failed.length) {
    warnings.push(`Part of the call schedule could not be loaded (${failed.join(', ')}) — figures may be incomplete.`)
  }
  // The unfiltered read always saturates while the table is larger than the cap;
  // that is expected and covered by the per-status reads, so it is not reported.
  const realSaturation = saturated.filter(s => s !== 'all')
  if (realSaturation.length) {
    warnings.push(`The call schedule hit the upstream ${UPSTREAM_PAGE_CAP}-row limit (${realSaturation.join(', ')}) — some calls are missing.`)
  }

  return Array.from(byId.values())
}

function resultFromApi(c: RawCall): CallResult | null {
  const bookingRef = (c.booking_ref ?? '').toUpperCase()
  if (!bookingRef) return null
  const kind = (c.kind ?? '').toLowerCase()
  const phase: CallPhase = kind === 'reconfirm' ? 'pre_tour' : kind === 'post_tour' ? 'post_tour' : 'on_tour'
  const rec = c as unknown as Record<string, unknown>
  return {
    phase,
    id: `${phase}:${c.id}`,
    serviceId: numOrNull(rec.service_id),
    scheduleId: c.schedule_id ?? null,
    bookingRef,
    conversationId: c.conversation_id ?? null,
    at: c.at ?? null,
    sentiment: c.sentiment ?? null,
    outcome: c.outcome ?? null,
    summary: c.summary ?? null,
    rating: numOrNull(rec.rating),
    detail: rec,
    raw: rec.raw,
  }
}

async function loadFromApi(warnings: string[]): Promise<ReportSource> {
  const [services, schedule, calls, alerts] = await Promise.all([
    safeList<RawService>('Services', () => teGet('services', { limit: UPSTREAM_PAGE_CAP }), ['services'], warnings),
    fetchSchedule(warnings),
    safeList<RawCall>('Call log', () => teGet('calls', { limit: 1000 }), ['calls'], warnings),
    safeList<RawAlert>('Alerts', () => teGet('alerts', { limit: 1000 }), ['alerts'], warnings),
  ])

  // The services list stops at 500 rows; a schedule row whose booking fell
  // off it must still count, so its service is stood in from the row itself.
  const known = new Set(services.map(s => s.id))
  for (const item of schedule) {
    if (item.service_id == null || known.has(item.service_id)) continue
    known.add(item.service_id)
    services.push({ id: item.service_id, booking_ref: item.booking_ref ?? '' })
  }

  return {
    source: 'api',
    services,
    schedule,
    results: calls.map(resultFromApi).filter((r): r is CallResult => r !== null),
    alerts,
    connectedServices: new Set(),
  }
}

// ── Insights ──

function answerOf(v: unknown): 'good' | 'bad' | 'unclear' {
  if (v === true || v === 1) return 'good'
  if (v === false || v === 0) return 'bad'
  const s = String(v ?? '').trim().toLowerCase()
  if (['good', 'yes', 'y', 'ok', 'okay', 'fine', 'excellent', 'great', 'happy', 'true', '1', 'correct', 'confirmed'].includes(s)) return 'good'
  if (['bad', 'no', 'n', 'poor', 'unhappy', 'issue', 'problem', 'false', '0', 'wrong', 'incorrect'].includes(s)) return 'bad'
  return 'unclear'
}

const AREA_KEYS: Record<CheckArea, string> = { hotel: 'hotel_ok', meals: 'meals_ok', driver: 'driver_ok', vehicle: 'vehicle_ok' }
const MISMATCH_KEYS = { dates: 'dates_ok', flight: 'flight_ok', pax: 'pax_ok', contact: 'contact_ok' } as const
const MISMATCH_LABEL: Record<keyof typeof MISMATCH_KEYS, string> = { dates: 'dates', flight: 'flights', pax: 'passengers', contact: 'contact' }

/** Issues kept in the payload; the totals still count every one. */
const MAX_ISSUES = 1500

function emptyVerdicts(): VerdictCounts {
  return { calls: 0, good: 0, warning: 0, bad: 0, none: 0 }
}

function emptyInsights(): CallInsights {
  const area = () => ({ good: 0, bad: 0, unclear: 0 })
  return {
    verdicts: { pre_tour: emptyVerdicts(), on_tour: emptyVerdicts(), post_tour: emptyVerdicts() },
    reconfirm: { calls: 0, confirmed: 0, changeRequested: 0, specialRequests: 0, mismatched: { dates: 0, flight: 0, pax: 0, contact: 0 } },
    onTour: {
      calls: 0,
      sentiment: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
      areas: { hotel: area(), meals: area(), driver: area(), vehicle: area() },
    },
    postTour: {
      calls: 0, rated: 0, avgRating: null, promoters: 0, passives: 0, detractors: 0, nps: null,
      recommendYes: 0, recommendNo: 0, notHomeSafely: 0,
    },
    alerts: { total: 0, open: 0, ack: 0, resolved: 0, high: 0, medium: 0, low: 0, byCategory: [] },
    ops: { overdue: 0, overdueBookings: 0, neverReached: 0, notApprovedWithPending: 0, failures: [] },
    issues: [],
    issueTotals: { bad: 0, warning: 0, shown: 0 },
  }
}

function alertPhase(a: RawAlert): CallPhase {
  const k = (a.call_kind ?? '').toLowerCase()
  if (k === 'reconfirm' || k === 'pre_tour') return 'pre_tour'
  if (k === 'post_tour') return 'post_tour'
  return 'on_tour'
}

/** What the call captured, in one line ops can read without opening it. */
function resultDetail(r: CallResult): string | null {
  const d = r.detail
  const parts: string[] = []
  if (r.phase === 'on_tour') {
    const bad = (Object.keys(AREA_KEYS) as CheckArea[]).filter(k => answerOf(d[AREA_KEYS[k]]) === 'bad')
    if (bad.length) parts.push(`Unhappy with: ${bad.join(', ')}`)
    const issues = clean(d.issues)
    if (issues) parts.push(issues)
  } else if (r.phase === 'pre_tour') {
    const mism = (Object.keys(MISMATCH_KEYS) as (keyof typeof MISMATCH_KEYS)[])
      .filter(k => answerOf(d[MISMATCH_KEYS[k]]) === 'bad').map(k => MISMATCH_LABEL[k])
    if (mism.length) parts.push(`Did not match: ${mism.join(', ')}`)
    const change = clean(d.requested_change)
    if (change) parts.push(`Change: ${change}`)
    const special = clean(d.special_requests)
    if (special) parts.push(`Special request: ${special}`)
  } else {
    if (r.rating != null) parts.push(`Rating ${r.rating}/10`)
    const imp = clean(d.improvements)
    if (imp) parts.push(`Improve: ${imp}`)
    const comment = clean(d.comment)
    if (comment) parts.push(comment)
  }
  // The summary retells the same call at length — only worth it when nothing
  // more specific was captured.
  const summary = clean(r.summary)
  if (summary && !parts.some(p => !p.startsWith('Rating '))) parts.push(summary)
  const text = parts.join(' · ')
  return text ? (text.length > 600 ? `${text.slice(0, 597)}…` : text) : null
}

function tallyResult(ins: CallInsights, r: CallResult, cls: FeedbackClass): void {
  const v = ins.verdicts[r.phase]
  v.calls++
  v[cls]++
  const d = r.detail

  if (r.phase === 'pre_tour') {
    const x = ins.reconfirm
    x.calls++
    if (cls === 'good') x.confirmed++
    if (clean(d.requested_change) || r.outcome === 'changes_requested') x.changeRequested++
    if (clean(d.special_requests)) x.specialRequests++
    for (const k of Object.keys(MISMATCH_KEYS) as (keyof typeof MISMATCH_KEYS)[]) {
      if (answerOf(d[MISMATCH_KEYS[k]]) === 'bad') x.mismatched[k]++
    }
  } else if (r.phase === 'on_tour') {
    const x = ins.onTour
    x.calls++
    x.sentiment[toSentiment(r.sentiment)]++
    for (const k of Object.keys(AREA_KEYS) as CheckArea[]) x.areas[k][answerOf(d[AREA_KEYS[k]])]++
  } else {
    const x = ins.postTour
    x.calls++
    if (r.rating != null) {
      x.rated++
      x.avgRating = (x.avgRating ?? 0) + r.rating // summed here, averaged in finalise
      if (r.rating >= 9) x.promoters++
      else if (r.rating >= 7) x.passives++
      else x.detractors++
    }
    const rec = answerOf(d.would_recommend)
    if (rec === 'good') x.recommendYes++
    if (rec === 'bad') x.recommendNo++
    if (answerOf(d.reached_home_safely) === 'bad') x.notHomeSafely++
  }
}

// ── Aggregation ──

export async function collectCallReport(
  filters: CallReportFilters,
  opts: { now?: Date } = {},
): Promise<CallReportData> {
  const now = opts.now ?? new Date()
  const window = buildCallReportWindow(filters, now)
  const warnings: string[] = []

  const [src, ledger] = await Promise.all([
    loadFromDatabase(window, filters.scope).catch(async (err: unknown) => {
      console.warn('[CallReport] database read failed, falling back to the API:',
        err instanceof Error ? err.message : String(err))
      warnings.push('The call database could not be read, so this report was built from the upstream API, which caps every list — figures may be lower than the real numbers.')
      return loadFromApi(warnings)
    }),
    getApprovalLedger().catch((): Record<string, ApprovalEntry> => ({})),
  ])

  // Index by service id first (always present upstream), booking ref second.
  const scheduleByService = new Map<number, RawScheduleItem[]>()
  const scheduleByRef = new Map<string, RawScheduleItem[]>()
  for (const item of src.schedule) {
    if (item.service_id != null) {
      const list = scheduleByService.get(item.service_id) ?? []
      list.push(item)
      scheduleByService.set(item.service_id, list)
    }
    const ref = (item.booking_ref ?? '').toUpperCase()
    if (ref) {
      const list = scheduleByRef.get(ref) ?? []
      list.push(item)
      scheduleByRef.set(ref, list)
    }
  }

  // ── Index the supporting lists by booking ref ──
  const resultsByRef = new Map<string, CallResult[]>()
  for (const r of src.results) {
    const list = resultsByRef.get(r.bookingRef) ?? []
    list.push(r)
    resultsByRef.set(r.bookingRef, list)
  }

  const alertsByRef = new Map<string, RawAlert[]>()
  for (const a of src.alerts) {
    const ref = (a.booking_ref ?? '').toUpperCase()
    if (!ref) continue
    const list = alertsByRef.get(ref) ?? []
    list.push(a)
    alertsByRef.set(ref, list)
  }

  const search = (filters.search ?? '').trim().toLowerCase()
  const phaseFilter = filters.phase && filters.phase !== 'all' ? filters.phase : null
  const localDay = (at: string | null | undefined): string | null => {
    if (!at) return null
    const d = new Date(at)
    return Number.isNaN(d.getTime()) ? dayOf(at) : dateInTz(d, window.timezone)
  }
  const dayInWindow = (day: string | null) =>
    filters.scope === 'assign_day' || (!!day && day >= window.fromDate && day <= window.toDate)

  const rows: CallReportRow[] = []
  const dailyIndex = new Map<string, DailyBreakdownRow>()
  for (const date of listDates(window.fromDate, window.toDate)) {
    dailyIndex.set(date, { date, all: 0, pre_tour: 0, on_tour: 0, post_tour: 0, done: 0, pending: 0, missed: 0 })
  }

  const totals: CallReportTotals = {
    bookings: 0,
    calls: emptyCounts(),
    byPhase: emptyPhaseCounts(),
    approval: { approved: 0, pending: 0, not_requested: 0 },
    urgentBookings: 0,
    openAlerts: 0,
    bookingsFullyCalled: 0,
    bookingsNotCalled: 0,
    completionRate: 0,
  }

  const insights = emptyInsights()
  const allIssues: CallIssue[] = []
  const failureReasons = new Map<string, number>()
  const alertCategories = new Map<string, number>()
  const seenRefs = new Set<string>()

  for (const svc of src.services) {
    const bookingRef = (svc.booking_ref ?? '').toUpperCase()
    // One row per booking, even if the upstream ever holds two services for it.
    if (!bookingRef || seenRefs.has(bookingRef)) continue

    const allItems = svc.schedule
      ?? scheduleByService.get(svc.id)
      ?? scheduleByRef.get(bookingRef)
      ?? []

    const assignedOn = svc.assigned_on
      ?? dayOf(svc.created_at ?? svc.registered_at)
      // No registration timestamp: the earliest scheduled call is the closest
      // honest stand-in for the day the booking was assigned.
      ?? allItems.map(i => dayOf(i.call_date)).filter(Boolean).sort()[0]
      ?? null

    // Scope decides *which* calls count: a call-date window, or every call of a
    // booking that was assigned on the chosen day.
    const inScope = (item: RawScheduleItem): boolean => {
      if (filters.scope === 'assign_day') return assignedOn === window.fromDate
      const d = dayOf(item.call_date)
      return !!d && d >= window.fromDate && d <= window.toDate
    }

    const items = allItems.filter(item => {
      if (!inScope(item)) return false
      if (phaseFilter && phaseOf(item) !== phaseFilter) return false
      return true
    })
    if (!items.length) continue

    if (search) {
      const haystack = `${bookingRef} ${svc.customer_name ?? ''} ${svc.call_phone ?? ''}`.toLowerCase()
      if (!haystack.includes(search)) continue
    }
    seenRefs.add(bookingRef)

    const counts = emptyCounts()
    const byPhase = emptyPhaseCounts()
    let lastCallAt: string | null = null
    let nextCallAt: string | null = null
    let overdue = 0

    for (const item of items) {
      const phase = phaseOf(item)
      addStatus(counts, item.status)
      addStatus(byPhase[phase], item.status)
      const s = item.status.toLowerCase()

      const day = dayOf(item.call_date)
      const bucket = day ? dailyIndex.get(day) : undefined
      if (bucket) {
        bucket.all++
        bucket[phase]++
        if (DONE_STATUSES.has(s)) bucket.done++
        else if (MISSED_STATUSES.has(s)) bucket.missed++
        else if (!SKIPPED_STATUSES.has(s)) bucket.pending++
      }

      // Still pending (or stuck mid-dial) on a day that has already gone — it
      // will not be made.
      if ((s === 'pending' || s === 'calling') && day && day < window.today) overdue++
      if (MISSED_STATUSES.has(s)) {
        const reason = clean(item.error) ?? (s === 'no_answer' ? 'No answer' : s === 'failed' ? 'Failed (no reason recorded)' : 'Missed (no reason recorded)')
        const key = reason.length > 90 ? `${reason.slice(0, 87)}…` : reason
        failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1)
      }

      if (item.last_attempt_at && (!lastCallAt || item.last_attempt_at > lastCallAt)) lastCallAt = item.last_attempt_at
      const upcoming = item.next_attempt_at ?? item.scheduled_at
      if (upcoming && upcoming >= now.toISOString() && (!nextCallAt || upcoming < nextCallAt)) nextCallAt = upcoming
    }

    // ── What the calls captured ──
    const itemById = new Map(items.map(i => [i.id, i]))
    const refResults = resultsByRef.get(bookingRef) ?? []
    const results = refResults.filter(r => {
      if (phaseFilter && r.phase !== phaseFilter) return false
      return r.scheduleId != null ? itemById.has(r.scheduleId) : dayInWindow(localDay(r.at))
    })

    // Latest logged call for this booking — outcome and sentiment.
    const latest = refResults.slice().sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0]
    // Approval belongs to the number, not to the window — so the evidence looks
    // at every call this booking has ever had, not just the filtered ones.
    const hasConnectedCall = src.connectedServices.has(svc.id)
      || refResults.some(c => !!c.conversationId)
      || allItems.some(i => DONE_STATUSES.has(i.status.toLowerCase()))
    if (latest?.at && (!lastCallAt || latest.at > lastCallAt)) lastCallAt = latest.at

    const refAlerts = alertsByRef.get(bookingRef) ?? []
    const openAlerts = refAlerts.filter(a => (a.status ?? 'open') === 'open')
    const topAlert = openAlerts.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]

    // Alerts the window's calls raised — the ones the issues list reports.
    const scopeAlerts = refAlerts.filter(a => {
      if (phaseFilter && alertPhase(a) !== phaseFilter) return false
      return a.schedule_id != null ? itemById.has(a.schedule_id) : dayInWindow(localDay(a.created_at ?? a.at))
    })
    const matchedAlerts = new Set<number>()

    const ledgerEntry = ledger[normalizePhone(svc.call_phone)]
    const approval = resolveApprovalState(ledgerEntry, hasConnectedCall)

    const feedback: CallReportRow['feedback'] = { worst: null, good: 0, warning: 0, bad: 0 }
    const rank: Record<FeedbackClass, number> = { none: 0, good: 1, warning: 2, bad: 3 }

    for (const r of results) {
      const own = scopeAlerts.filter(a =>
        (r.scheduleId != null && a.schedule_id === r.scheduleId)
        || (!!r.conversationId && a.conversation_id === r.conversationId))
      own.forEach(a => matchedAlerts.add(a.id))

      const verdict = classifyFeedback({
        kind: r.phase === 'pre_tour' ? 'reconfirm' : r.phase,
        sentiment: r.sentiment ? r.sentiment.toLowerCase() : null,
        outcome: r.outcome,
        rating: r.rating,
        detail: r.detail,
        raw: r.raw,
        transcriptTurns: r.summary ? 1 : 0,
        alerts: own.map(a => ({ severity: a.severity ?? null, category: a.category ?? null, status: a.status ?? null, title: a.title ?? null })),
      })
      tallyResult(insights, r, verdict.cls)
      if (verdict.cls !== 'none') {
        feedback[verdict.cls]++
        if (!feedback.worst || rank[verdict.cls] > rank[feedback.worst]) feedback.worst = verdict.cls
      }

      if (verdict.cls === 'bad' || verdict.cls === 'warning') {
        const item = r.scheduleId != null ? itemById.get(r.scheduleId) : undefined
        const top = own.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]
        allIssues.push({
          id: r.id,
          phase: r.phase,
          level: verdict.cls,
          source: 'call',
          bookingRef,
          customerName: svc.customer_name ?? null,
          phone: svc.call_phone ?? null,
          date: (item && dayOf(item.call_date)) ?? localDay(r.at),
          at: r.at,
          reason: verdict.reason,
          detail: resultDetail(r),
          verdictBy: verdict.source,
          alert: top ? { severity: top.severity ?? null, category: top.category ?? null, status: top.status ?? null } : null,
        })
      }
    }

    // An alert whose call never reached a result table is still an issue.
    for (const a of scopeAlerts) {
      if (matchedAlerts.has(a.id)) continue
      const item = a.schedule_id != null ? itemById.get(a.schedule_id) : undefined
      const level: IssueLevel = a.severity === 'high' && a.category !== 'change_request' ? 'bad' : 'warning'
      allIssues.push({
        id: `alert:${a.id}`,
        phase: alertPhase(a),
        level,
        source: 'alert',
        bookingRef,
        customerName: svc.customer_name ?? null,
        phone: svc.call_phone ?? null,
        date: (item && dayOf(item.call_date)) ?? localDay(a.created_at ?? a.at),
        at: a.created_at ?? a.at ?? null,
        reason: a.title || `${(a.category ?? 'complaint').replace(/_/g, ' ')} raised on a call`,
        detail: clean(a.details) ?? clean(a.customer_quote),
        verdictBy: 'alert',
        alert: { severity: a.severity ?? null, category: a.category ?? null, status: a.status ?? null },
      })
    }

    for (const a of scopeAlerts) {
      insights.alerts.total++
      const st = (a.status ?? 'open').toLowerCase()
      if (st === 'open') insights.alerts.open++
      else if (st === 'ack') insights.alerts.ack++
      else if (st === 'resolved') insights.alerts.resolved++
      const sev = (a.severity ?? 'medium').toLowerCase()
      if (sev === 'high') insights.alerts.high++
      else if (sev === 'low') insights.alerts.low++
      else insights.alerts.medium++
      const cat = (a.category ?? 'other').replace(/_/g, ' ')
      alertCategories.set(cat, (alertCategories.get(cat) ?? 0) + 1)
    }

    const callDone: CallDoneState =
      counts.done === 0 ? 'not_done'
        : counts.done + counts.skipped >= counts.assigned ? 'done'
          : 'partial'

    if (overdue) { insights.ops.overdue += overdue; insights.ops.overdueBookings++ }
    if (counts.done === 0 && counts.missed > 0) insights.ops.neverReached++
    if (approval !== 'approved' && counts.pending > 0) insights.ops.notApprovedWithPending++

    rows.push({
      bookingRef,
      customerName: svc.customer_name ?? null,
      phone: svc.call_phone ?? null,
      serviceStatus: (svc.status ?? 'active').toLowerCase(),
      assignedOn,
      counts,
      byPhase,
      callDone,
      approval,
      approvalLabel: APPROVAL_LABEL[approval],
      approvalRequestedAt: ledgerEntry?.requestedAt ?? null,
      urgent: {
        open: openAlerts.length,
        total: refAlerts.length,
        severity: (topAlert?.severity as UrgentSummary['severity']) ?? null,
        latestTitle: topAlert?.title ?? null,
      },
      lastCallAt,
      nextCallAt,
      lastOutcome: latest?.outcome ?? null,
      lastSentiment: latest?.sentiment ?? null,
      feedback,
    })

    mergeCounts(totals.calls, counts)
    for (const phase of CALL_PHASES) mergeCounts(totals.byPhase[phase], byPhase[phase])
    totals.approval[approval]++
    if (openAlerts.length) { totals.urgentBookings++; totals.openAlerts += openAlerts.length }
    if (callDone === 'done') totals.bookingsFullyCalled++
    if (callDone === 'not_done') totals.bookingsNotCalled++
  }

  // ── Finish the insights ──
  const pt = insights.postTour
  if (pt.rated) {
    pt.avgRating = Math.round(((pt.avgRating ?? 0) / pt.rated) * 10) / 10
    pt.nps = Math.round(((pt.promoters - pt.detractors) / pt.rated) * 100)
  }
  insights.alerts.byCategory = Array.from(alertCategories, ([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
  insights.ops.failures = Array.from(failureReasons, ([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  allIssues.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'bad' ? -1 : 1
    return (b.date ?? '').localeCompare(a.date ?? '') || (b.at ?? '').localeCompare(a.at ?? '')
  })
  insights.issueTotals = {
    bad: allIssues.filter(i => i.level === 'bad').length,
    warning: allIssues.filter(i => i.level === 'warning').length,
    shown: Math.min(allIssues.length, MAX_ISSUES),
  }
  insights.issues = allIssues.slice(0, MAX_ISSUES)

  if (filters.onlyUrgent) {
    const urgentRefs = new Set(rows.filter(r => r.urgent.open > 0).map(r => r.bookingRef))
    insights.issues = insights.issues.filter(i => urgentRefs.has(i.bookingRef))
  }

  // "Only urgent" narrows the table after the tiles have been totalled, so the
  // headline figures keep describing the whole window.
  totals.bookings = rows.length
  const visible = filters.onlyUrgent ? rows.filter(r => r.urgent.open > 0) : rows

  return finalise(filters, window, totals, visible, dailyIndex, insights, src.source, warnings, now)
}

function finalise(
  filters: CallReportFilters,
  window: CallReportWindow,
  totals: CallReportTotals,
  rows: CallReportRow[],
  dailyIndex: Map<string, DailyBreakdownRow>,
  insights: CallInsights,
  source: CallReportData['source'],
  warnings: string[],
  now: Date,
): CallReportData {
  totals.completionRate = totals.calls.assigned
    ? Math.round((totals.calls.done / totals.calls.assigned) * 100)
    : 0

  rows.sort((a, b) => {
    // Urgent first, then the bookings still waiting on a call, then by ref.
    if (b.urgent.open !== a.urgent.open) return b.urgent.open - a.urgent.open
    if (b.counts.pending !== a.counts.pending) return b.counts.pending - a.counts.pending
    return a.bookingRef.localeCompare(b.bookingRef)
  })

  return {
    window,
    filters,
    totals,
    rows,
    daily: Array.from(dailyIndex.values()).sort((a, b) => a.date.localeCompare(b.date)),
    insights,
    source,
    generatedAt: now.toISOString(),
    warnings,
  }
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRows(rows: unknown[][]): string {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n')
}

export function renderCallReportCsv(d: CallReportData): string {
  const bookings: unknown[][] = [
    ['Booking Ref', 'Customer', 'Contact Number', 'Assigned On', 'Service Status',
      'Assigned Calls', 'Done', 'Pending', 'Missed', 'Skipped',
      'Pre-tour', 'On-tour', 'Post-tour',
      'WhatsApp Approval', 'Approval Requested', 'Call Done', 'Urgent (open alerts)', 'Top Severity',
      'Last Call', 'Next Call', 'Last Outcome', 'Sentiment',
      'Feedback', 'Bad Calls', 'Warning Calls', 'Good Calls'],
    ...d.rows.map(r => [
      r.bookingRef, r.customerName ?? '', r.phone ?? '', r.assignedOn ?? '', r.serviceStatus,
      r.counts.assigned, r.counts.done, r.counts.pending, r.counts.missed, r.counts.skipped,
      r.byPhase.pre_tour.assigned, r.byPhase.on_tour.assigned, r.byPhase.post_tour.assigned,
      r.approvalLabel, r.approvalRequestedAt ?? '',
      r.callDone === 'done' ? 'Done' : r.callDone === 'partial' ? 'Partial' : 'Not called',
      r.urgent.open, r.urgent.severity ?? '',
      r.lastCallAt ?? '', r.nextCallAt ?? '', r.lastOutcome ?? '', r.lastSentiment ?? '',
      r.feedback.worst ?? '', r.feedback.bad, r.feedback.warning, r.feedback.good,
    ]),
  ]

  const daily: unknown[][] = [
    [],
    ['Daily calls'],
    ['Date', 'All calls', 'Pre-tour', 'On-tour', 'Post-tour', 'Done', 'Pending', 'Missed'],
    ...d.daily.map(x => [x.date, x.all, x.pre_tour, x.on_tour, x.post_tour, x.done, x.pending, x.missed]),
  ]

  const summary: unknown[][] = [
    ['AI Voice Call Report'],
    ['Window', d.window.label],
    ['From', d.window.fromDate], ['To', d.window.toDate],
    ['Timezone', d.window.timezone],
    ['Generated', d.generatedAt],
    [],
    ['Bookings', d.totals.bookings],
    ['Assigned calls', d.totals.calls.assigned],
    ['Done', d.totals.calls.done],
    ['Pending', d.totals.calls.pending],
    ['Missed', d.totals.calls.missed],
    ['Completion rate %', d.totals.completionRate],
    ['Approved numbers', d.totals.approval.approved],
    ['Awaiting approval', d.totals.approval.pending],
    ['Approval not sent', d.totals.approval.not_requested],
    ['Urgent bookings', d.totals.urgentBookings],
    ['Open alerts', d.totals.openAlerts],
    ['Data source', d.source === 'database' ? 'Call database (complete)' : 'Upstream API (capped)'],
    [],
  ]

  const ins = d.insights
  const insightRows: unknown[][] = [
    ['Call feedback'],
    ['Call type', 'Calls captured', 'Good', 'Warning', 'Bad', 'No feedback'],
    ...CALL_PHASES.map(p => [PHASE_LABEL[p], ins.verdicts[p].calls, ins.verdicts[p].good, ins.verdicts[p].warning, ins.verdicts[p].bad, ins.verdicts[p].none]),
    [],
    ['Reconfirmation', 'Calls', ins.reconfirm.calls, 'Confirmed', ins.reconfirm.confirmed, 'Change requested', ins.reconfirm.changeRequested,
      'Special requests', ins.reconfirm.specialRequests, 'Dates wrong', ins.reconfirm.mismatched.dates,
      'Flights wrong', ins.reconfirm.mismatched.flight, 'Pax wrong', ins.reconfirm.mismatched.pax, 'Contact wrong', ins.reconfirm.mismatched.contact],
    ['On-tour', 'Calls', ins.onTour.calls, 'Positive', ins.onTour.sentiment.positive, 'Neutral', ins.onTour.sentiment.neutral,
      'Negative', ins.onTour.sentiment.negative,
      ...(['hotel', 'meals', 'driver', 'vehicle'] as const).flatMap(k => [`${k} bad`, ins.onTour.areas[k].bad])],
    ['Post-tour', 'Calls', ins.postTour.calls, 'Rated', ins.postTour.rated, 'Average /10', ins.postTour.avgRating ?? '',
      'NPS', ins.postTour.nps ?? '', 'Would recommend', ins.postTour.recommendYes, 'Would not', ins.postTour.recommendNo,
      'Not home safely', ins.postTour.notHomeSafely],
    ['Alerts', 'Total', ins.alerts.total, 'Open', ins.alerts.open, 'High', ins.alerts.high, 'Medium', ins.alerts.medium, 'Low', ins.alerts.low],
    ['Operations', 'Overdue pending calls', ins.ops.overdue, 'Bookings never reached', ins.ops.neverReached,
      'Not approved with calls pending', ins.ops.notApprovedWithPending],
    ...ins.ops.failures.map(f => ['Missed/failed reason', f.reason, f.count]),
    [],
  ]

  const issues: unknown[][] = [
    [],
    [`Warnings & issues (${ins.issueTotals.bad} bad, ${ins.issueTotals.warning} warning)`],
    ['Level', 'Call type', 'Date', 'Booking Ref', 'Customer', 'Contact Number', 'Issue', 'Detail', 'Judged by', 'Alert severity', 'Alert status'],
    ...ins.issues.map(i => [
      i.level, PHASE_LABEL[i.phase], i.date ?? '', i.bookingRef, i.customerName ?? '', i.phone ?? '',
      i.reason, i.detail ?? '', i.verdictBy, i.alert?.severity ?? '', i.alert?.status ?? '',
    ]),
  ]

  return csvRows([...summary, ...insightRows, ...bookings, ...daily, ...issues])
}
