/**
 * The AI voice-call report — one data model behind the dashboard page, the CSV
 * download and the emailed daily report.
 *
 * Everything is derived from three upstream lists:
 *   • `services`  — one per booking registered for AI calls, carrying the full
 *                   schedule of assigned calls (this is the backbone: an
 *                   "assigned call" is a schedule row, whether or not it ran)
 *   • `calls`     — the log of calls that actually happened, for outcome,
 *                   sentiment and proof that a number is WhatsApp-approved
 *   • `alerts`    — complaints / urgent asks raised on a call
 *
 * Call phases are named the way ops speaks about them rather than the way the
 * upstream stores them: a `reconfirm` schedule row is a **pre-tour** call, a
 * plain day row is **on-tour**, and `post_tour` stays as it is.
 */
import {
  APPROVAL_LABEL, getApprovalLedger, resolveApprovalState,
  type ApprovalEntry, type ApprovalState,
} from './call-approvals'
import { normalizePhone, teGet, teList } from './te-api'
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
  booking_ref?: string | null
  severity?: string | null
  status?: string | null
  category?: string | null
  title?: string | null
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

export interface CallReportData {
  window: CallReportWindow
  filters: CallReportFilters
  totals: CallReportTotals
  rows: CallReportRow[]
  daily: DailyBreakdownRow[]
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
    warnings.push(`The call schedule hit the upstream ${UPSTREAM_PAGE_CAP}-row limit (${realSaturation.join(', ')}) — the oldest calls may be missing.`)
  }

  return Array.from(byId.values())
}

export async function collectCallReport(
  filters: CallReportFilters,
  opts: { now?: Date } = {},
): Promise<CallReportData> {
  const now = opts.now ?? new Date()
  const window = buildCallReportWindow(filters, now)
  const warnings: string[] = []

  const [services, schedule, calls, alerts, ledger] = await Promise.all([
    // 401 registered bookings today: asked wide, because this list is also
    // returned oldest-first and a short limit would drop the newest bookings.
    safeList<RawService>('Services', () => teGet('services', { limit: UPSTREAM_PAGE_CAP }), ['services'], warnings),
    // The services list does not embed schedules, so the schedule is read in
    // bulk rather than once per service — see `fetchSchedule` for why that read
    // has to be split by status.
    fetchSchedule(warnings),
    safeList<RawCall>('Call log', () => teGet('calls', { limit: 1000 }), ['calls'], warnings),
    safeList<RawAlert>('Alerts', () => teGet('alerts', { limit: 500 }), ['alerts'], warnings),
    getApprovalLedger().catch((): Record<string, ApprovalEntry> => ({})),
  ])

  // Index by service id first (always present upstream), booking ref second.
  const scheduleByService = new Map<number, RawScheduleItem[]>()
  const scheduleByRef = new Map<string, RawScheduleItem[]>()
  for (const item of schedule) {
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
  const callsByRef = new Map<string, RawCall[]>()
  for (const c of calls) {
    const ref = (c.booking_ref ?? '').toUpperCase()
    if (!ref) continue
    const list = callsByRef.get(ref) ?? []
    list.push(c)
    callsByRef.set(ref, list)
  }

  const alertsByRef = new Map<string, RawAlert[]>()
  for (const a of alerts) {
    const ref = (a.booking_ref ?? '').toUpperCase()
    if (!ref) continue
    const list = alertsByRef.get(ref) ?? []
    list.push(a)
    alertsByRef.set(ref, list)
  }

  const search = (filters.search ?? '').trim().toLowerCase()
  const phaseFilter = filters.phase && filters.phase !== 'all' ? filters.phase : null

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

  for (const svc of services) {
    const bookingRef = (svc.booking_ref ?? '').toUpperCase()
    if (!bookingRef) continue

    const allItems = svc.schedule
      ?? scheduleByService.get(svc.id)
      ?? scheduleByRef.get(bookingRef)
      ?? []

    const assignedOn = dayOf(svc.created_at ?? svc.registered_at)
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

    const counts = emptyCounts()
    const byPhase = emptyPhaseCounts()
    let lastCallAt: string | null = null
    let nextCallAt: string | null = null

    for (const item of items) {
      const phase = phaseOf(item)
      addStatus(counts, item.status)
      addStatus(byPhase[phase], item.status)

      const day = dayOf(item.call_date)
      const bucket = day ? dailyIndex.get(day) : undefined
      if (bucket) {
        bucket.all++
        bucket[phase]++
        const s = item.status.toLowerCase()
        if (DONE_STATUSES.has(s)) bucket.done++
        else if (MISSED_STATUSES.has(s)) bucket.missed++
        else if (!SKIPPED_STATUSES.has(s)) bucket.pending++
      }

      if (item.last_attempt_at && (!lastCallAt || item.last_attempt_at > lastCallAt)) lastCallAt = item.last_attempt_at
      const upcoming = item.next_attempt_at ?? item.scheduled_at
      if (upcoming && upcoming >= now.toISOString() && (!nextCallAt || upcoming < nextCallAt)) nextCallAt = upcoming
    }

    // Latest logged call for this booking — outcome, sentiment, and the proof
    // that the customer's number is WhatsApp-approved.
    const logged = (callsByRef.get(bookingRef) ?? []).slice().sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    const latest = logged[0]
    // Approval belongs to the number, not to the window — so the evidence looks
    // at every call this booking has ever had, not just the filtered ones.
    const hasConnectedCall = logged.some(c => !!c.conversation_id)
      || allItems.some(i => DONE_STATUSES.has(i.status.toLowerCase()))
    if (latest?.at && (!lastCallAt || latest.at > lastCallAt)) lastCallAt = latest.at

    const refAlerts = alertsByRef.get(bookingRef) ?? []
    const openAlerts = refAlerts.filter(a => (a.status ?? 'open') === 'open')
    const topAlert = openAlerts.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]

    const ledgerEntry = ledger[normalizePhone(svc.call_phone)]
    const approval = resolveApprovalState(ledgerEntry, hasConnectedCall)

    const callDone: CallDoneState =
      counts.done === 0 ? 'not_done'
        : counts.done + counts.skipped >= counts.assigned ? 'done'
          : 'partial'

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
    })

    mergeCounts(totals.calls, counts)
    for (const phase of CALL_PHASES) mergeCounts(totals.byPhase[phase], byPhase[phase])
    totals.approval[approval]++
    if (openAlerts.length) { totals.urgentBookings++; totals.openAlerts += openAlerts.length }
    if (callDone === 'done') totals.bookingsFullyCalled++
    if (callDone === 'not_done') totals.bookingsNotCalled++
  }

  // "Only urgent" narrows the table after the tiles have been totalled, so the
  // headline figures keep describing the whole window.
  totals.bookings = rows.length
  const visible = filters.onlyUrgent ? rows.filter(r => r.urgent.open > 0) : rows

  return finalise(filters, window, totals, visible, dailyIndex, warnings, now)
}

function finalise(
  filters: CallReportFilters,
  window: CallReportWindow,
  totals: CallReportTotals,
  rows: CallReportRow[],
  dailyIndex: Map<string, DailyBreakdownRow>,
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
      'Last Call', 'Next Call', 'Last Outcome', 'Sentiment'],
    ...d.rows.map(r => [
      r.bookingRef, r.customerName ?? '', r.phone ?? '', r.assignedOn ?? '', r.serviceStatus,
      r.counts.assigned, r.counts.done, r.counts.pending, r.counts.missed, r.counts.skipped,
      r.byPhase.pre_tour.assigned, r.byPhase.on_tour.assigned, r.byPhase.post_tour.assigned,
      r.approvalLabel, r.approvalRequestedAt ?? '',
      r.callDone === 'done' ? 'Done' : r.callDone === 'partial' ? 'Partial' : 'Not called',
      r.urgent.open, r.urgent.severity ?? '',
      r.lastCallAt ?? '', r.nextCallAt ?? '', r.lastOutcome ?? '', r.lastSentiment ?? '',
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
    [],
  ]

  return csvRows([...summary, ...bookings, ...daily])
}
