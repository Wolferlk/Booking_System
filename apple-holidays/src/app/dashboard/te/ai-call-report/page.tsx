'use client'

/**
 * AI Voice Calls — Report.
 *
 * Two questions, one page: *who* was assigned calls (the booking table, filtered
 * by call day, month or the day the booking was registered) and *what happened
 * today* (the pre-tour / on-tour / post-tour breakdown). The same data backs the
 * CSV download and the daily email configured at the bottom, so the report ops
 * reads on screen and the one that lands in their inbox can never disagree.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BarChart2, Bot, CalendarDays, CalendarRange, CheckCircle2,
  ClipboardCheck, Clock, Download, FileSpreadsheet, Filter, Loader2, Mail,
  MailCheck, PhoneCall, PhoneMissed, Printer, RefreshCw, Search, Send,
  ShieldCheck, Award, XCircle, Users, Database, ThumbsDown, ThumbsUp, Star,
} from 'lucide-react'
import { toast } from 'sonner'
import Header from '@/components/layout/header'

// ─── Types (mirrors src/lib/te/call-report-data.ts) ───────────────────────────

type CallScope = 'day' | 'month' | 'range' | 'assign_day'
type CallPhase = 'pre_tour' | 'on_tour' | 'post_tour'
type PhaseFilter = CallPhase | 'all'
type ApprovalState = 'approved' | 'pending' | 'not_requested'
type CallDoneState = 'done' | 'partial' | 'not_done'
type Coverage = 'today' | 'yesterday' | 'this_month'

interface CallCounts { assigned: number; done: number; pending: number; missed: number; skipped: number }

interface ReportRow {
  bookingRef: string
  customerName: string | null
  phone: string | null
  serviceStatus: string
  assignedOn: string | null
  counts: CallCounts
  byPhase: Record<CallPhase, CallCounts>
  callDone: CallDoneState
  approval: ApprovalState
  approvalLabel: string
  approvalRequestedAt: string | null
  urgent: { open: number; total: number; severity: 'high' | 'medium' | 'low' | null; latestTitle: string | null }
  lastCallAt: string | null
  nextCallAt: string | null
  lastOutcome: string | null
  lastSentiment: string | null
  feedback: { worst: Verdict | null; good: number; warning: number; bad: number }
}

type Verdict = 'good' | 'warning' | 'bad' | 'none'
type CheckArea = 'hotel' | 'meals' | 'driver' | 'vehicle'

interface CallIssue {
  id: string
  phase: CallPhase
  level: 'bad' | 'warning'
  source: 'call' | 'alert'
  bookingRef: string
  customerName: string | null
  phone: string | null
  date: string | null
  at: string | null
  reason: string
  detail: string | null
  verdictBy: 'ai' | 'rules' | 'alert'
  alert: { severity: string | null; category: string | null; status: string | null } | null
}

interface VerdictCounts { calls: number; good: number; warning: number; bad: number; none: number }

interface Insights {
  verdicts: Record<CallPhase, VerdictCounts>
  reconfirm: { calls: number; confirmed: number; changeRequested: number; specialRequests: number; mismatched: { dates: number; flight: number; pax: number; contact: number } }
  onTour: { calls: number; sentiment: { positive: number; neutral: number; negative: number; unknown: number }; areas: Record<CheckArea, { good: number; bad: number; unclear: number }> }
  postTour: { calls: number; rated: number; avgRating: number | null; promoters: number; passives: number; detractors: number; nps: number | null; recommendYes: number; recommendNo: number; notHomeSafely: number }
  alerts: { total: number; open: number; ack: number; resolved: number; high: number; medium: number; low: number; byCategory: { category: string; count: number }[] }
  ops: { overdue: number; overdueBookings: number; neverReached: number; notApprovedWithPending: number; failures: { reason: string; count: number }[] }
  issues: CallIssue[]
  issueTotals: { bad: number; warning: number; shown: number }
}

interface DailyRow {
  date: string; all: number; pre_tour: number; on_tour: number; post_tour: number
  done: number; pending: number; missed: number
}

interface ReportData {
  window: { scope: CallScope; fromDate: string; toDate: string; timezone: string; today: string; label: string }
  totals: {
    bookings: number
    calls: CallCounts
    byPhase: Record<CallPhase, CallCounts>
    approval: Record<ApprovalState, number>
    urgentBookings: number
    openAlerts: number
    bookingsFullyCalled: number
    bookingsNotCalled: number
    completionRate: number
  }
  rows: ReportRow[]
  daily: DailyRow[]
  insights: Insights
  source: 'database' | 'api'
  generatedAt: string
  warnings: string[]
}

interface ScheduleConfig {
  enabled: boolean
  hour: number
  minute: number
  timezone: string
  coverage: Coverage
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo: string | null
  subjectPrefix: string | null
  attachCsv: boolean
  skipIfEmpty: boolean
  maxRows: number
  updatedAt: string | null
  updatedBy: string | null
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | 'skipped' | null
  lastError: string | null
  lastRecipients: number | null
}

interface RunLog {
  id: string
  trigger: string
  triggeredBy: string | null
  status: 'ok' | 'error' | 'skipped'
  recipients: number
  windowFrom: string
  windowTo: string
  assigned: number
  done: number
  pending: number
  urgent: number
  error: string | null
  at: string
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const PHASE_META: Record<CallPhase, { label: string; icon: React.ElementType; ring: string; text: string; bar: string }> = {
  pre_tour:  { label: 'Pre-tour',  icon: ClipboardCheck, ring: 'border-sky-200 bg-sky-50',       text: 'text-sky-700',    bar: 'bg-sky-500' },
  on_tour:   { label: 'On-tour',   icon: PhoneCall,      ring: 'border-violet-200 bg-violet-50', text: 'text-violet-700', bar: 'bg-violet-500' },
  post_tour: { label: 'Post-tour', icon: Award,          ring: 'border-amber-200 bg-amber-50',   text: 'text-amber-700',  bar: 'bg-amber-500' },
}

const APPROVAL_META: Record<ApprovalState, { label: string; cls: string }> = {
  approved:      { label: 'Approved',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  pending:       { label: 'Awaiting',   cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  not_requested: { label: 'Not sent',   cls: 'bg-slate-100 text-slate-500 border-slate-200' },
}

const VERDICT_META: Record<Verdict, { label: string; cls: string; bar: string }> = {
  good:    { label: 'Good',    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  warning: { label: 'Warning', cls: 'bg-amber-100 text-amber-700 border-amber-200',       bar: 'bg-amber-400' },
  bad:     { label: 'Bad',     cls: 'bg-red-100 text-red-700 border-red-200',             bar: 'bg-red-500' },
  none:    { label: 'No feedback', cls: 'bg-slate-100 text-slate-500 border-slate-200',  bar: 'bg-slate-300' },
}

const DONE_META: Record<CallDoneState, { label: string; cls: string }> = {
  done:     { label: 'Done',       cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  partial:  { label: 'Partial',    cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  not_done: { label: 'Not called', cls: 'bg-red-100 text-red-600 border-red-200' },
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function fmtDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short',
  })
}

function fmtDT(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function emailList(value: string): string[] {
  return value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AICallReportPage() {
  // Filters
  const [scope, setScope]   = useState<CallScope>('day')
  const [date, setDate]     = useState(todayISO())
  const [month, setMonth]   = useState(todayISO().slice(0, 7))
  const [from, setFrom]     = useState(shift(todayISO(), -6))
  const [to, setTo]         = useState(todayISO())
  const [phase, setPhase]   = useState<PhaseFilter>('all')
  const [search, setSearch] = useState('')
  const [onlyUrgent, setOnlyUrgent] = useState(false)

  const [data, setData]       = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const query = useMemo(() => {
    const p = new URLSearchParams({ scope, phase })
    if (scope === 'day' || scope === 'assign_day') p.set('date', date)
    if (scope === 'month') p.set('month', month)
    if (scope === 'range') { p.set('from', from); p.set('to', to) }
    if (search.trim()) p.set('search', search.trim())
    if (onlyUrgent) p.set('urgent', '1')
    return p.toString()
  }, [scope, phase, date, month, from, to, search, onlyUrgent])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/te/call-report?${query}`).then(r => r.json())
      if (!res.success) throw new Error(res.error ?? 'Failed to build the report')
      setData(res.data as ReportData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build the report')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [query])

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void load() }, 300)
    return () => clearTimeout(t)
  }, [load])

  const totals = data?.totals
  const showDaily = (data?.daily.length ?? 0) > 1

  return (
    <div className="flex flex-col min-h-screen bg-slate-950">
      <Header
        title={<span className="flex items-center gap-2"><BarChart2 className="w-5 h-5 text-violet-400" /> AI Call Report</span>}
        subtitle="Assigned calls, approvals and daily results — auto-generated, downloadable, emailed"
        actions={
          <div className="flex items-center gap-2">
            <a href={`/api/te/call-report?${query}&format=csv`}
              className="btn-secondary btn btn-sm" title="Download the full report as CSV">
              <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
            </a>
            <a href={`/api/te/call-report?${query}&format=html`} target="_blank" rel="noopener noreferrer"
              className="btn-secondary btn btn-sm" title="Open a print-ready copy — save as PDF from the print dialog">
              <Printer className="w-3.5 h-3.5" /> PDF
            </a>
            <button onClick={() => void load()} className="btn-secondary btn btn-sm" disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
            </button>
          </div>
        }
      />

      {/* ── Headline figures ── */}
      <div className="bg-gradient-to-r from-violet-900/30 via-purple-900/20 to-indigo-900/30 border-b border-violet-800/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center">
          {[
            { label: 'Assigned calls', value: totals?.calls.assigned ?? 0, color: 'text-violet-300' },
            { label: 'Done',           value: totals?.calls.done ?? 0,     color: 'text-emerald-400' },
            { label: 'Pending',        value: totals?.calls.pending ?? 0,  color: 'text-orange-400' },
            { label: 'Missed',         value: totals?.calls.missed ?? 0,   color: 'text-red-400' },
            { label: 'Bookings',       value: totals?.bookings ?? 0,       color: 'text-slate-200' },
            { label: 'Urgent',         value: totals?.urgentBookings ?? 0, color: (totals?.urgentBookings ?? 0) > 0 ? 'text-red-400' : 'text-slate-400' },
            { label: 'Approved',       value: totals?.approval.approved ?? 0, color: 'text-emerald-400' },
            { label: 'Bad calls',      value: data?.insights.issueTotals.bad ?? 0, color: (data?.insights.issueTotals.bad ?? 0) > 0 ? 'text-red-400' : 'text-slate-400' },
            { label: 'Warnings',       value: data?.insights.issueTotals.warning ?? 0, color: (data?.insights.issueTotals.warning ?? 0) > 0 ? 'text-amber-400' : 'text-slate-400' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2">
              <span className={`text-lg font-black ${s.color}`}>{s.value}</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">{s.label}</span>
            </div>
          ))}
          <div className="ml-auto text-[10px] text-slate-500 hidden sm:flex items-center gap-2">
            {data && (
              <span title={data.source === 'database' ? 'Every call row read from the call database' : 'Built from the capped upstream API — figures may be low'}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${
                  data.source === 'database' ? 'border-emerald-700/50 text-emerald-400' : 'border-amber-700/50 text-amber-400'}`}>
                <Database className="w-2.5 h-2.5" /> {data.source === 'database' ? 'Live DB · complete' : 'API · partial'}
              </span>
            )}
            {data ? `${data.window.label} · ${data.window.timezone}` : '—'}
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        <FilterBar
          scope={scope} setScope={setScope}
          date={date} setDate={setDate}
          month={month} setMonth={setMonth}
          from={from} setFrom={setFrom}
          to={to} setTo={setTo}
          phase={phase} setPhase={setPhase}
          search={search} setSearch={setSearch}
          onlyUrgent={onlyUrgent} setOnlyUrgent={setOnlyUrgent}
        />

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 flex items-start gap-3">
            <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-red-700">Report unavailable</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {data?.warnings.map(w => (
          <div key={w} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <p className="text-xs text-amber-700">{w}</p>
          </div>
        ))}

        {loading && !data ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-20 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
            <p className="text-xs text-slate-400">Building the report…</p>
          </div>
        ) : data ? (
          <>
            <DailyCallsPanel data={data} />
            <OpsWarnings data={data} />
            <FeedbackInsightsPanel data={data} />
            <IssuesPanel data={data} />
            {showDaily && <ByDateTable daily={data.daily} />}
            <BookingTable data={data} />
          </>
        ) : null}

        <AutoEmailPanel />
      </main>
    </div>
  )
}

// ─── Filters ──────────────────────────────────────────────────────────────────

interface FilterBarProps {
  scope: CallScope; setScope: (v: CallScope) => void
  date: string; setDate: (v: string) => void
  month: string; setMonth: (v: string) => void
  from: string; setFrom: (v: string) => void
  to: string; setTo: (v: string) => void
  phase: PhaseFilter; setPhase: (v: PhaseFilter) => void
  search: string; setSearch: (v: string) => void
  onlyUrgent: boolean; setOnlyUrgent: (v: boolean) => void
}

const SCOPE_TABS: { key: CallScope; label: string; icon: React.ElementType; hint: string }[] = [
  { key: 'day',        label: 'By day',       icon: CalendarDays,  hint: 'Calls scheduled on one date' },
  { key: 'month',      label: 'By month',     icon: CalendarRange, hint: 'A whole calendar month' },
  { key: 'range',      label: 'Date range',   icon: CalendarRange, hint: 'Any span of dates' },
  { key: 'assign_day', label: 'By assign day', icon: Users,        hint: 'Bookings registered on one date — all of their calls' },
]

function FilterBar(p: FilterBarProps) {
  const active = SCOPE_TABS.find(t => t.key === p.scope)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs font-bold text-slate-700">Filter</span>
        {active && <span className="text-[11px] text-slate-400">· {active.hint}</span>}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {SCOPE_TABS.map(t => (
            <button key={t.key} onClick={() => p.setScope(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                p.scope === t.key
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'}`}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(p.scope === 'day' || p.scope === 'assign_day') && (
            <div>
              <label className="form-label">{p.scope === 'assign_day' ? 'Assigned on' : 'Call date'}</label>
              <input type="date" className="form-input" value={p.date} onChange={e => p.setDate(e.target.value)} />
              <div className="flex gap-1.5 mt-1.5">
                {[
                  { label: 'Today', value: todayISO() },
                  { label: 'Yesterday', value: shift(todayISO(), -1) },
                  { label: 'Tomorrow', value: shift(todayISO(), 1) },
                ].map(q => (
                  <button key={q.label} onClick={() => p.setDate(q.value)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                      p.date === q.value ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {p.scope === 'month' && (
            <div>
              <label className="form-label">Month</label>
              <input type="month" className="form-input" value={p.month} onChange={e => p.setMonth(e.target.value)} />
            </div>
          )}

          {p.scope === 'range' && (
            <>
              <div>
                <label className="form-label">From</label>
                <input type="date" className="form-input" value={p.from} onChange={e => p.setFrom(e.target.value)} />
              </div>
              <div>
                <label className="form-label">To</label>
                <input type="date" className="form-input" value={p.to} onChange={e => p.setTo(e.target.value)} />
              </div>
            </>
          )}

          <div>
            <label className="form-label">Call type</label>
            <select className="form-select" value={p.phase} onChange={e => p.setPhase(e.target.value as PhaseFilter)}>
              <option value="all">All calls</option>
              <option value="pre_tour">Pre-tour only</option>
              <option value="on_tour">On-tour only</option>
              <option value="post_tour">Post-tour only</option>
            </select>
          </div>

          <div>
            <label className="form-label">Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className="form-input pl-8" placeholder="IS48375 · name · number"
                value={p.search} onChange={e => p.setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <input type="checkbox" className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            checked={p.onlyUrgent} onChange={e => p.setOnlyUrgent(e.target.checked)} />
          <span className="text-xs font-semibold text-slate-600">Only bookings with an open urgent alert</span>
        </label>
      </div>
    </div>
  )
}

// ─── Daily calls — full report ────────────────────────────────────────────────

function CountsStrip({ c }: { c: CallCounts }) {
  return (
    <div className="flex items-center gap-3 text-[11px] font-semibold">
      <span className="text-emerald-600">{c.done} done</span>
      <span className="text-orange-500">{c.pending} pending</span>
      <span className="text-red-500">{c.missed} missed</span>
      {c.skipped > 0 && <span className="text-slate-400">{c.skipped} skipped</span>}
    </div>
  )
}

function DailyCallsPanel({ data }: { data: ReportData }) {
  const t = data.totals
  const tiles: { key: 'all' | CallPhase; label: string; counts: CallCounts; icon: React.ElementType; accent: string }[] = [
    { key: 'all', label: 'All calls', counts: t.calls, icon: PhoneCall, accent: 'from-slate-900 to-slate-700' },
    { key: 'pre_tour',  label: 'Pre-tour',  counts: t.byPhase.pre_tour,  icon: ClipboardCheck, accent: 'from-sky-600 to-blue-500' },
    { key: 'on_tour',   label: 'On-tour',   counts: t.byPhase.on_tour,   icon: PhoneCall,      accent: 'from-violet-600 to-purple-500' },
    { key: 'post_tour', label: 'Post-tour', counts: t.byPhase.post_tour, icon: Award,          accent: 'from-amber-500 to-orange-500' },
  ]

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center"><PhoneCall className="w-4 h-4 text-violet-600" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Daily calls — full report</h3>
          <p className="text-xs text-slate-500">{data.window.label}</p>
        </div>
        <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
          {t.completionRate}% completed
        </span>
      </div>

      <div className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(tile => (
          <div key={tile.key} className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className={`bg-gradient-to-r ${tile.accent} px-4 py-2.5 flex items-center gap-2`}>
              <tile.icon className="w-3.5 h-3.5 text-white/90" />
              <span className="text-[11px] font-bold text-white uppercase tracking-wide">{tile.label}</span>
            </div>
            <div className="p-4">
              <p className="text-3xl font-black text-slate-900 leading-none">{tile.counts.assigned}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-1 mb-2.5">assigned</p>
              <CountsStrip c={tile.counts} />
              <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden flex">
                {tile.counts.assigned > 0 && (
                  <>
                    <div className="bg-emerald-500 h-full" style={{ width: `${(tile.counts.done / tile.counts.assigned) * 100}%` }} />
                    <div className="bg-orange-400 h-full" style={{ width: `${(tile.counts.pending / tile.counts.assigned) * 100}%` }} />
                    <div className="bg-red-500 h-full" style={{ width: `${(tile.counts.missed / tile.counts.assigned) * 100}%` }} />
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Approval + attention summary */}
      <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: ShieldCheck,   label: 'WhatsApp approved', value: t.approval.approved,      note: 'accepting AI calls',    cls: 'text-emerald-600' },
          { icon: Clock,         label: 'Awaiting approval', value: t.approval.pending,       note: 'message sent, no reply', cls: 'text-amber-600' },
          { icon: Mail,          label: 'Guest Not Approved', value: t.approval.not_requested, note: 'cannot be called yet',  cls: 'text-slate-500' },
          { icon: AlertTriangle, label: 'Urgent bookings',   value: t.urgentBookings,         note: `${t.openAlerts} open alerts`, cls: t.urgentBookings ? 'text-red-600' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 flex items-center gap-3">
            <s.icon className={`w-4 h-4 ${s.cls} flex-shrink-0`} />
            <div className="min-w-0">
              <p className={`text-xl font-black leading-none ${s.cls}`}>{s.value}</p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-1">{s.label}</p>
              <p className="text-[10px] text-slate-400">{s.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Calls by date ────────────────────────────────────────────────────────────

function ByDateTable({ daily }: { daily: DailyRow[] }) {
  const peak = Math.max(1, ...daily.map(d => d.all))

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center"><CalendarRange className="w-4 h-4 text-sky-600" /></div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">Calls by date</h3>
          <p className="text-xs text-slate-500">{daily.length} days · all calls split by type</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60">
              {['Date', 'Volume', 'All', 'Pre-tour', 'On-tour', 'Post-tour', 'Done', 'Pending', 'Missed'].map((h, i) => (
                <th key={h} className={`px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {daily.map(d => (
              <tr key={d.date} className={`border-b border-slate-100 last:border-0 ${d.all === 0 ? 'opacity-50' : 'hover:bg-slate-50/60'} transition-colors`}>
                <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">{fmtDay(d.date)}</td>
                <td className="px-3 py-2 w-40">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden flex">
                    <div className="bg-sky-500 h-full" style={{ width: `${(d.pre_tour / peak) * 100}%` }} />
                    <div className="bg-violet-500 h-full" style={{ width: `${(d.on_tour / peak) * 100}%` }} />
                    <div className="bg-amber-500 h-full" style={{ width: `${(d.post_tour / peak) * 100}%` }} />
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-bold text-slate-900">{d.all}</td>
                <td className="px-3 py-2 text-right text-sky-600">{d.pre_tour}</td>
                <td className="px-3 py-2 text-right text-violet-600">{d.on_tour}</td>
                <td className="px-3 py-2 text-right text-amber-600">{d.post_tour}</td>
                <td className="px-3 py-2 text-right text-emerald-600 font-semibold">{d.done}</td>
                <td className="px-3 py-2 text-right text-orange-500 font-semibold">{d.pending}</td>
                <td className="px-3 py-2 text-right text-red-500 font-semibold">{d.missed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Assigned calls by booking ────────────────────────────────────────────────

const BOOKING_PAGE = 100

function BookingTable({ data }: { data: ReportData }) {
  const [limit, setLimit] = useState(BOOKING_PAGE)
  useEffect(() => { setLimit(BOOKING_PAGE) }, [data])
  const shown = data.rows.slice(0, limit)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center"><Bot className="w-4 h-4 text-violet-600" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Total assigned calls for bookings</h3>
          <p className="text-xs text-slate-500">{data.rows.length} booking{data.rows.length === 1 ? '' : 's'} · {data.window.label}</p>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className="text-xs text-slate-400 italic px-5 py-10 text-center">No calls assigned in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                {[
                  { label: 'IS / Booking', align: 'text-left' },
                  { label: 'Contact number', align: 'text-left' },
                  { label: 'Urgent', align: 'text-center' },
                  { label: 'WhatsApp approval', align: 'text-center' },
                  { label: 'Assigned', align: 'text-right' },
                  { label: 'Pre / On / Post', align: 'text-center' },
                  { label: 'Done · Pending', align: 'text-left' },
                  { label: 'Call done', align: 'text-center' },
                  { label: 'Feedback', align: 'text-center' },
                  { label: 'Last call', align: 'text-left' },
                ].map(h => (
                  <th key={h.label}
                    className={`px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap ${h.align}`}>
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.bookingRef}
                  className={`border-b border-slate-100 last:border-0 transition-colors ${r.urgent.open ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50/60'}`}>
                  <td className="px-3 py-2.5">
                    <div className="font-mono font-bold text-slate-900">{r.bookingRef}</div>
                    {r.customerName && <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{r.customerName}</div>}
                    {r.assignedOn && <div className="text-[10px] text-slate-300">assigned {fmtDay(r.assignedOn)}</div>}
                  </td>

                  <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{r.phone ?? '—'}</td>

                  <td className="px-3 py-2.5 text-center">
                    {r.urgent.open ? (
                      <span
                        title={r.urgent.latestTitle ?? undefined}
                        className={`inline-flex items-center gap-1 border font-bold rounded-full text-[9px] px-2 py-0.5 ${
                          r.urgent.severity === 'high' ? 'bg-red-100 text-red-700 border-red-200'
                            : r.urgent.severity === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        <AlertTriangle className="w-2.5 h-2.5" /> {r.urgent.open}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-flex items-center gap-1 border font-bold rounded-full text-[9px] px-2 py-0.5 ${APPROVAL_META[r.approval].cls}`}>
                      {r.approval === 'approved' ? <CheckCircle2 className="w-2.5 h-2.5" />
                        : r.approval === 'pending' ? <Clock className="w-2.5 h-2.5" />
                          : <Mail className="w-2.5 h-2.5" />}
                      {APPROVAL_META[r.approval].label}
                    </span>
                    {r.approval === 'pending' && r.approvalRequestedAt && (
                      <div className="text-[9px] text-slate-400 mt-0.5">sent {fmtDT(r.approvalRequestedAt)}</div>
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-right font-bold text-slate-900">{r.counts.assigned}</td>

                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      {(['pre_tour', 'on_tour', 'post_tour'] as CallPhase[]).map(ph => (
                        <span key={ph} title={`${PHASE_META[ph].label}: ${r.byPhase[ph].assigned} assigned`}
                          className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded-md border text-[10px] font-bold ${
                            r.byPhase[ph].assigned ? `${PHASE_META[ph].ring} ${PHASE_META[ph].text}` : 'border-slate-100 text-slate-300'}`}>
                          {r.byPhase[ph].assigned}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="text-emerald-600 font-bold">{r.counts.done}</span>
                    <span className="text-slate-300"> · </span>
                    <span className="text-orange-500 font-bold">{r.counts.pending}</span>
                    {r.counts.missed > 0 && <span className="text-red-500 font-bold"> · {r.counts.missed} missed</span>}
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-flex items-center gap-1 border font-bold rounded-full text-[9px] px-2 py-0.5 ${DONE_META[r.callDone].cls}`}>
                      {r.callDone === 'done' ? <CheckCircle2 className="w-2.5 h-2.5" />
                        : r.callDone === 'partial' ? <PhoneCall className="w-2.5 h-2.5" />
                          : <PhoneMissed className="w-2.5 h-2.5" />}
                      {r.callDone === 'partial' ? `${r.counts.done}/${r.counts.assigned}` : DONE_META[r.callDone].label}
                    </span>
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    {r.feedback.worst ? (
                      <span title={`${r.feedback.good} good · ${r.feedback.warning} warning · ${r.feedback.bad} bad`}
                        className={`inline-flex items-center border font-bold rounded-full text-[9px] px-2 py-0.5 ${VERDICT_META[r.feedback.worst].cls}`}>
                        {VERDICT_META[r.feedback.worst].label}
                        {(r.feedback.worst === 'bad' || r.feedback.worst === 'warning') && ` ${r.feedback[r.feedback.worst]}`}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>

                  <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">
                    {fmtDT(r.lastCallAt)}
                    {r.nextCallAt && <div className="text-[10px] text-blue-400">next {fmtDT(r.nextCallAt)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length > limit && (
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Showing {shown.length} of {data.rows.length} bookings — the CSV has them all</span>
              <button onClick={() => setLimit(l => l + BOOKING_PAGE * 3)} className="btn-secondary btn btn-sm">Show more</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Operational warnings ─────────────────────────────────────────────────────

function OpsWarnings({ data }: { data: ReportData }) {
  const o = data.insights.ops
  const items = [
    o.overdue > 0 && { tone: 'red', text: `${o.overdue} call${o.overdue === 1 ? '' : 's'} still pending on a day that has passed`, note: `${o.overdueBookings} booking${o.overdueBookings === 1 ? '' : 's'} — these will not be dialled` },
    o.neverReached > 0 && { tone: 'amber', text: `${o.neverReached} booking${o.neverReached === 1 ? '' : 's'} never reached`, note: 'every call so far was missed or failed' },
    o.notApprovedWithPending > 0 && { tone: 'amber', text: `${o.notApprovedWithPending} booking${o.notApprovedWithPending === 1 ? '' : 's'} not WhatsApp-approved`, note: 'calls are pending but the guest has not accepted' },
  ].filter(Boolean) as { tone: 'red' | 'amber'; text: string; note: string }[]
  if (!items.length && !o.failures.length) return null
  const peak = Math.max(1, ...o.failures.map(f => f.count))

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-amber-600" /></div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">Operational warnings</h3>
          <p className="text-xs text-slate-500">Calls that will not, or did not, happen</p>
        </div>
      </div>
      <div className="p-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {items.length === 0 && <p className="text-xs text-slate-400 italic">No scheduling warnings.</p>}
          {items.map(i => (
            <div key={i.text} className={`rounded-xl border px-4 py-2.5 ${i.tone === 'red' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className={`text-xs font-bold ${i.tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{i.text}</p>
              <p className={`text-[11px] ${i.tone === 'red' ? 'text-red-600' : 'text-amber-600'}`}>{i.note}</p>
            </div>
          ))}
        </div>
        {o.failures.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Why calls were missed / failed</p>
            <div className="space-y-1.5">
              {o.failures.map(f => (
                <div key={f.reason} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 min-w-0 truncate text-slate-600" title={f.reason}>{f.reason}</span>
                  <div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-red-400" style={{ width: `${(f.count / peak) * 100}%` }} /></div>
                  <span className="w-12 text-right font-bold text-slate-800">{f.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Feedback insights: reconfirmation · on-tour · post-tour ──────────────────

function pctOf(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—'
}

function VerdictBar({ v }: { v: VerdictCounts }) {
  const total = v.good + v.warning + v.bad + v.none
  return (
    <div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
        {total > 0 && (['good', 'warning', 'bad', 'none'] as Verdict[]).map(k => (
          <div key={k} className={`${VERDICT_META[k].bar} h-full`} style={{ width: `${(v[k] / total) * 100}%` }} />
        ))}
      </div>
      <div className="flex items-center gap-2.5 mt-1.5 text-[10px] font-semibold">
        <span className="text-emerald-600">{v.good} good</span>
        <span className="text-amber-600">{v.warning} warning</span>
        <span className="text-red-600">{v.bad} bad</span>
        {v.none > 0 && <span className="text-slate-400">{v.none} no feedback</span>}
      </div>
    </div>
  )
}

function Stat({ label, value, tone = 'text-slate-800' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-bold ${tone}`}>{value}</span>
    </div>
  )
}

function FeedbackInsightsPanel({ data }: { data: ReportData }) {
  const ins = data.insights
  const rc = ins.reconfirm
  const ot = ins.onTour
  const pt = ins.postTour
  const captured = ins.verdicts.pre_tour.calls + ins.verdicts.on_tour.calls + ins.verdicts.post_tour.calls

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center"><ThumbsUp className="w-4 h-4 text-emerald-600" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Call feedback — reconfirmation · on-tour · post-tour</h3>
          <p className="text-xs text-slate-500">{captured} call{captured === 1 ? '' : 's'} captured a result · {data.window.label}</p>
        </div>
      </div>

      <div className="p-4 grid gap-3 lg:grid-cols-4 sm:grid-cols-2">
        {/* Reconfirmation */}
        <div className="rounded-2xl border border-sky-200 overflow-hidden">
          <div className="bg-gradient-to-r from-sky-600 to-blue-500 px-4 py-2.5 flex items-center gap-2">
            <ClipboardCheck className="w-3.5 h-3.5 text-white/90" />
            <span className="text-[11px] font-bold text-white uppercase tracking-wide">Reconfirmation</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-baseline gap-2"><p className="text-3xl font-black text-slate-900 leading-none">{rc.calls}</p><p className="text-[10px] text-slate-400 uppercase">calls captured</p></div>
            <VerdictBar v={ins.verdicts.pre_tour} />
            <div>
              <Stat label="Confirmed" value={`${rc.confirmed} · ${pctOf(rc.confirmed, rc.calls)}`} tone="text-emerald-600" />
              <Stat label="Change requested" value={rc.changeRequested} tone={rc.changeRequested ? 'text-amber-600' : 'text-slate-400'} />
              <Stat label="Special requests" value={rc.specialRequests} tone={rc.specialRequests ? 'text-sky-600' : 'text-slate-400'} />
              <Stat label="Dates wrong" value={rc.mismatched.dates} tone={rc.mismatched.dates ? 'text-red-600' : 'text-slate-400'} />
              <Stat label="Flights wrong" value={rc.mismatched.flight} tone={rc.mismatched.flight ? 'text-red-600' : 'text-slate-400'} />
              <Stat label="Passengers wrong" value={rc.mismatched.pax} tone={rc.mismatched.pax ? 'text-red-600' : 'text-slate-400'} />
              <Stat label="Contact wrong" value={rc.mismatched.contact} tone={rc.mismatched.contact ? 'text-red-600' : 'text-slate-400'} />
            </div>
          </div>
        </div>

        {/* On-tour */}
        <div className="rounded-2xl border border-violet-200 overflow-hidden">
          <div className="bg-gradient-to-r from-violet-600 to-purple-500 px-4 py-2.5 flex items-center gap-2">
            <PhoneCall className="w-3.5 h-3.5 text-white/90" />
            <span className="text-[11px] font-bold text-white uppercase tracking-wide">On-tour check-ins</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-baseline gap-2"><p className="text-3xl font-black text-slate-900 leading-none">{ot.calls}</p><p className="text-[10px] text-slate-400 uppercase">calls captured</p></div>
            <VerdictBar v={ins.verdicts.on_tour} />
            <div>
              <Stat label="Positive" value={`${ot.sentiment.positive} · ${pctOf(ot.sentiment.positive, ot.calls)}`} tone="text-emerald-600" />
              <Stat label="Neutral / mixed" value={ot.sentiment.neutral} />
              <Stat label="Negative" value={ot.sentiment.negative} tone={ot.sentiment.negative ? 'text-red-600' : 'text-slate-400'} />
              {(['hotel', 'meals', 'driver', 'vehicle'] as CheckArea[]).map(k => (
                <Stat key={k} label={`${k[0].toUpperCase()}${k.slice(1)} — bad / good`}
                  value={<><span className={ot.areas[k].bad ? 'text-red-600' : 'text-slate-400'}>{ot.areas[k].bad}</span><span className="text-slate-300"> / </span><span className="text-emerald-600">{ot.areas[k].good}</span></>} />
              ))}
            </div>
          </div>
        </div>

        {/* Post-tour */}
        <div className="rounded-2xl border border-amber-200 overflow-hidden">
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 flex items-center gap-2">
            <Award className="w-3.5 h-3.5 text-white/90" />
            <span className="text-[11px] font-bold text-white uppercase tracking-wide">Post-tour feedback</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-black text-slate-900 leading-none">{pt.avgRating ?? '—'}</p>
              <p className="text-[10px] text-slate-400 uppercase">avg /10 · {pt.calls} calls</p>
            </div>
            <VerdictBar v={ins.verdicts.post_tour} />
            <div>
              <Stat label="Rated" value={pt.rated} />
              <Stat label="NPS" value={pt.nps ?? '—'} tone={pt.nps == null ? 'text-slate-400' : pt.nps >= 50 ? 'text-emerald-600' : pt.nps >= 0 ? 'text-amber-600' : 'text-red-600'} />
              <Stat label="Promoters 9–10" value={pt.promoters} tone="text-emerald-600" />
              <Stat label="Passives 7–8" value={pt.passives} />
              <Stat label="Detractors 0–6" value={pt.detractors} tone={pt.detractors ? 'text-red-600' : 'text-slate-400'} />
              <Stat label="Would recommend · not" value={`${pt.recommendYes} · ${pt.recommendNo}`} />
              <Stat label="Not home safely" value={pt.notHomeSafely} tone={pt.notHomeSafely ? 'text-red-600' : 'text-slate-400'} />
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div className="rounded-2xl border border-red-200 overflow-hidden">
          <div className="bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-white/90" />
            <span className="text-[11px] font-bold text-white uppercase tracking-wide">Alerts raised</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-baseline gap-2"><p className="text-3xl font-black text-slate-900 leading-none">{ins.alerts.total}</p><p className="text-[10px] text-slate-400 uppercase">{ins.alerts.open} still open</p></div>
            <div>
              <Stat label="High severity" value={ins.alerts.high} tone={ins.alerts.high ? 'text-red-600' : 'text-slate-400'} />
              <Stat label="Medium" value={ins.alerts.medium} tone={ins.alerts.medium ? 'text-amber-600' : 'text-slate-400'} />
              <Stat label="Low" value={ins.alerts.low} />
              <Stat label="Acknowledged" value={ins.alerts.ack} />
              <Stat label="Resolved" value={ins.alerts.resolved} tone="text-emerald-600" />
              {ins.alerts.byCategory.slice(0, 5).map(c => (
                <Stat key={c.category} label={c.category} value={c.count} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Warnings & issues ────────────────────────────────────────────────────────

const ISSUE_PAGE = 50

function IssuesPanel({ data }: { data: ReportData }) {
  const ins = data.insights
  const [phase, setPhase] = useState<'all' | CallPhase>('all')
  const [level, setLevel] = useState<'all' | 'bad' | 'warning'>('all')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(ISSUE_PAGE)
  useEffect(() => { setLimit(ISSUE_PAGE) }, [data, phase, level, q])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return ins.issues.filter(i =>
      (phase === 'all' || i.phase === phase)
      && (level === 'all' || i.level === level)
      && (!needle || `${i.bookingRef} ${i.customerName ?? ''} ${i.reason} ${i.detail ?? ''}`.toLowerCase().includes(needle)))
  }, [ins.issues, phase, level, q])

  const countFor = (p: 'all' | CallPhase) => ins.issues.filter(i => p === 'all' || i.phase === p).length
  const total = ins.issueTotals.bad + ins.issueTotals.warning

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center"><ThumbsDown className="w-4 h-4 text-red-600" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Warnings &amp; issues</h3>
          <p className="text-xs text-slate-500">
            <span className="text-red-600 font-semibold">{ins.issueTotals.bad} bad</span> ·{' '}
            <span className="text-amber-600 font-semibold">{ins.issueTotals.warning} warning</span> · {data.window.label}
            {ins.issueTotals.shown < total && ` · newest ${ins.issueTotals.shown} shown, all in the CSV`}
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Booking, name, issue…"
            className="form-input pl-8 w-56 text-xs" />
        </div>
      </div>

      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        {(['all', 'pre_tour', 'on_tour', 'post_tour'] as const).map(p => (
          <button key={p} onClick={() => setPhase(p)}
            className={`text-[11px] font-semibold rounded-full px-3 py-1 border transition-colors ${
              phase === p ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {p === 'all' ? 'All' : p === 'pre_tour' ? 'Reconfirmation' : p === 'on_tour' ? 'On-tour' : 'Post-tour / feedback'} · {countFor(p)}
          </button>
        ))}
        <span className="w-px h-5 bg-slate-200 mx-1" />
        {(['all', 'bad', 'warning'] as const).map(l => (
          <button key={l} onClick={() => setLevel(l)}
            className={`text-[11px] font-semibold rounded-full px-3 py-1 border transition-colors ${
              level === l
                ? l === 'bad' ? 'bg-red-600 text-white border-red-600' : l === 'warning' ? 'bg-amber-500 text-white border-amber-500' : 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {l === 'all' ? 'Bad + warning' : l === 'bad' ? 'Bad only' : 'Warning only'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400 italic px-5 py-10 text-center">
          {total ? 'No issues match these filters.' : 'No bad or warning calls in this window.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                {['Level', 'Call', 'Booking', 'Issue', 'Alert'].map(h => (
                  <th key={h} className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map(i => (
                <tr key={i.id} className={`border-b border-slate-100 last:border-0 align-top ${i.level === 'bad' ? 'bg-red-50/30' : ''}`}>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center border font-bold rounded-full text-[9px] px-2 py-0.5 ${VERDICT_META[i.level].cls}`}>
                      {VERDICT_META[i.level].label}
                    </span>
                    <div className="text-[9px] text-slate-400 mt-1">{i.verdictBy === 'ai' ? 'AI review' : i.verdictBy === 'alert' ? 'alert' : 'rules'}</div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`font-semibold ${PHASE_META[i.phase].text}`}>{i.phase === 'pre_tour' ? 'Reconfirmation' : PHASE_META[i.phase].label}</span>
                    <div className="text-[10px] text-slate-400">{i.date ? fmtDay(i.date) : '—'}</div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="font-mono font-bold text-slate-900">{i.bookingRef}</div>
                    {i.customerName && <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{i.customerName}</div>}
                    {i.phone && <div className="text-[10px] text-slate-300 font-mono">{i.phone}</div>}
                  </td>
                  <td className="px-3 py-2.5 min-w-[280px]">
                    <p className="font-semibold text-slate-800">{i.reason}</p>
                    {i.detail && <p className="text-[11px] text-slate-500 mt-0.5 whitespace-pre-line">{i.detail}</p>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {i.alert ? (
                      <>
                        <span className={`inline-flex items-center gap-1 border font-bold rounded-full text-[9px] px-2 py-0.5 ${
                          i.alert.severity === 'high' ? 'bg-red-100 text-red-700 border-red-200'
                            : i.alert.severity === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          <Star className="w-2.5 h-2.5" /> {i.alert.severity ?? '—'}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">{(i.alert.category ?? '').replace(/_/g, ' ')} · {i.alert.status ?? 'open'}</div>
                      </>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > limit && (
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Showing {limit} of {filtered.length}</span>
              <button onClick={() => setLimit(l => l + ISSUE_PAGE * 2)} className="btn-secondary btn btn-sm">Show more</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Daily auto-email ─────────────────────────────────────────────────────────

function AutoEmailPanel() {
  const [config, setConfig]   = useState<ScheduleConfig | null>(null)
  const [runs, setRuns]       = useState<RunLog[]>([])
  const [nextRun, setNextRun] = useState<string | null>(null)
  const [sender, setSender]   = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [sending, setSending] = useState<'now' | 'test' | null>(null)

  // Recipient lists are edited as free text and normalised on save.
  const [toText, setToText]   = useState('')
  const [ccText, setCcText]   = useState('')
  const [bccText, setBccText] = useState('')
  const [testTo, setTestTo]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/te/call-report/schedule').then(r => r.json())
      if (!res.success) throw new Error(res.error ?? 'Failed to load settings')
      const c = res.data.config as ScheduleConfig
      setConfig(c)
      setRuns(res.data.runs ?? [])
      setNextRun(res.data.nextRunAt ?? null)
      setSender(res.data.sender ?? '')
      setToText(c.to.join(', '))
      setCcText(c.cc.join(', '))
      setBccText(c.bcc.join(', '))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save(patch: Partial<ScheduleConfig> = {}) {
    if (!config) return
    setSaving(true)
    try {
      const body = {
        ...config, ...patch,
        to: emailList(toText), cc: emailList(ccText), bcc: emailList(bccText),
      }
      const res = await fetch('/api/te/call-report/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json())
      if (!res.success) throw new Error(res.error ?? 'Save failed')
      setConfig(res.data.config)
      setNextRun(res.data.nextRunAt ?? null)
      toast.success(res.message ?? 'Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function send(kind: 'now' | 'test') {
    setSending(kind)
    try {
      const res = await fetch('/api/te/call-report/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'test' ? { test: true, to: emailList(testTo) } : {}),
      }).then(r => r.json())
      if (!res.success) throw new Error(res.error ?? 'Send failed')
      toast.success(res.message ?? 'Sent')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(null)
    }
  }

  if (loading || !config) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center"><MailCheck className="w-4 h-4 text-emerald-600" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Automatic daily email</h3>
          <p className="text-xs text-slate-500">
            {config.enabled
              ? `On — next send ${nextRun ? new Date(nextRun).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}`
              : 'Off — the report is only generated when you open this page'}
          </p>
        </div>
        <button
          onClick={() => void save({ enabled: !config.enabled })}
          disabled={saving}
          className={`relative w-11 h-6 rounded-full transition-colors ${config.enabled ? 'bg-emerald-500' : 'bg-slate-300'} disabled:opacity-50`}
          aria-label="Toggle the daily email">
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${config.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="form-label">Send time</label>
            <input type="time" className="form-input" value={`${pad(config.hour)}:${pad(config.minute)}`}
              onChange={e => {
                const [h, m] = e.target.value.split(':').map(Number)
                setConfig({ ...config, hour: h || 0, minute: m || 0 })
              }} />
          </div>
          <div>
            <label className="form-label">Timezone</label>
            <input className="form-input" value={config.timezone}
              onChange={e => setConfig({ ...config, timezone: e.target.value })} placeholder="Asia/Colombo" />
          </div>
          <div className="lg:col-span-2">
            <label className="form-label">What the email covers</label>
            <select className="form-select" value={config.coverage}
              onChange={e => setConfig({ ...config, coverage: e.target.value as Coverage })}>
              <option value="today">Today&apos;s assigned calls — best for a morning send</option>
              <option value="yesterday">Yesterday&apos;s calls and results — best for an evening send</option>
              <option value="this_month">This month to date</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div>
            <label className="form-label">To *</label>
            <textarea className="form-input min-h-[64px] font-mono text-xs" value={toText}
              onChange={e => setToText(e.target.value)} placeholder="ops@aahaas.com, manager@aahaas.com" />
          </div>
          <div>
            <label className="form-label">CC</label>
            <textarea className="form-input min-h-[64px] font-mono text-xs" value={ccText}
              onChange={e => setCcText(e.target.value)} />
          </div>
          <div>
            <label className="form-label">BCC</label>
            <textarea className="form-input min-h-[64px] font-mono text-xs" value={bccText}
              onChange={e => setBccText(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Subject prefix</label>
            <input className="form-input" value={config.subjectPrefix ?? ''}
              onChange={e => setConfig({ ...config, subjectPrefix: e.target.value })} placeholder="[Apple Holidays]" />
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                checked={config.attachCsv} onChange={e => setConfig({ ...config, attachCsv: e.target.checked })} />
              <span className="text-xs font-semibold text-slate-600">Attach CSV</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                checked={config.skipIfEmpty} onChange={e => setConfig({ ...config, skipIfEmpty: e.target.checked })} />
              <span className="text-xs font-semibold text-slate-600">Skip when there are no calls</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button onClick={() => void save()} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Save settings
          </button>

          <button onClick={() => void send('now')} disabled={sending !== null || !config.to.length}
            title={config.to.length ? 'Send the report to the configured recipients now' : 'Add a recipient first'}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
            {sending === 'now' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send now
          </button>

          <div className="flex items-center gap-1.5 ml-auto">
            <input className="form-input h-9 w-56 text-xs font-mono" placeholder="test@aahaas.com"
              value={testTo} onChange={e => setTestTo(e.target.value)} />
            <button onClick={() => void send('test')} disabled={sending !== null || !testTo.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
              {sending === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 rotate-180" />} Send test
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          Sent from <span className="font-mono">{sender || '—'}</span>. A test send does not use up the day&apos;s scheduled send.
          {config.lastError && <span className="text-red-500"> · Last error: {config.lastError}</span>}
        </p>

        {runs.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Recent sends</p>
            <div className="space-y-1">
              {runs.slice(0, 8).map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[11px] py-1 border-b border-slate-50 last:border-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    r.status === 'ok' ? 'bg-emerald-500' : r.status === 'error' ? 'bg-red-500' : 'bg-slate-300'}`} />
                  <span className="text-slate-500 w-32 flex-shrink-0">{fmtDT(r.at)}</span>
                  <span className="text-slate-400 w-16 flex-shrink-0">{r.trigger}</span>
                  <span className="text-slate-600 flex-1 truncate">
                    {r.status === 'ok'
                      ? `${r.assigned} assigned · ${r.done} done · ${r.pending} pending → ${r.recipients} recipient${r.recipients === 1 ? '' : 's'}`
                      : r.error ?? r.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
