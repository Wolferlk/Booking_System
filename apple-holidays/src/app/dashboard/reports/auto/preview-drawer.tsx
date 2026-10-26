'use client'

/**
 * Full-screen preview of a report.
 *
 * The email body is rendered in a sandboxed iframe from the same endpoint the
 * mailer uses, so what is on screen is literally the message that will be sent —
 * no second renderer to drift out of sync.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2, Mail, Monitor,
  RotateCcw, Smartphone, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { dateInTz, shiftDate } from '@/lib/reports/report-window'
import type { ReportType, Schedule } from './types'

export interface PreviewRequest {
  scheduleId?: string
  reportType?: ReportType
  period?: string
  timezone?: string
  countries?: string[]
  aiSummary?: boolean
  maxRows?: number
  /** WEEKLY drafts: the send weekday, which decides where the weeks start. */
  dayOfWeek?: number
  title?: string
  /** `yyyy-mm-dd` to back-date the preview to; empty means the latest period. */
  date?: string
  /** SALES drafts: the Travel Quote GPT office team; empty = whole company. */
  team?: string | null
  /** SALES only: a free date range, inclusive. Overrides `date`. */
  from?: string
  to?: string
}

/** Build the query the preview endpoint expects from either a saved id or a draft. */
export function previewQuery(req: PreviewRequest): string {
  const p = new URLSearchParams()
  if (req.scheduleId) p.set('scheduleId', req.scheduleId)
  else {
    p.set('reportType', req.reportType ?? 'OPS')
    p.set('period', req.period ?? 'DAILY')
    if (req.timezone) p.set('timezone', req.timezone)
    if (req.countries?.length) p.set('countries', req.countries.join(','))
    if (req.aiSummary) p.set('aiSummary', 'true')
    if (req.maxRows) p.set('maxRows', String(req.maxRows))
    if (req.dayOfWeek != null) p.set('dayOfWeek', String(req.dayOfWeek))
    if (req.team) p.set('team', req.team)
  }
  if (req.from || req.to) {
    if (req.from) p.set('from', req.from)
    if (req.to) p.set('to', req.to)
    return p.toString()
  }
  // Applies to both shapes — a saved schedule can be previewed for a past day
  // without touching what it will send tomorrow morning.
  if (req.date) p.set('date', req.date)
  return p.toString()
}

export function previewRequestFor(draft: Partial<Schedule>): PreviewRequest {
  return {
    // A saved schedule previews by id so the exact stored config is used;
    // an unsaved draft previews its in-flight values instead.
    scheduleId: draft.id,
    reportType: draft.reportType,
    period: draft.period,
    timezone: draft.timezone,
    countries: draft.countries,
    aiSummary: draft.aiSummary,
    maxRows: draft.maxRows,
    dayOfWeek: draft.dayOfWeek,
    team: draft.salesTeam ?? null,
    title: draft.name || 'Preview',
  }
}

interface PreviewEnvelope { success?: boolean; error?: string; data?: unknown }

/**
 * Read the endpoint's JSON, tolerating a body that is not JSON at all.
 *
 * Building a report is the longest request in the dashboard, and when the
 * platform cuts it off it answers with its own HTML error page. Calling
 * `res.json()` on that reports the parser's complaint ("Unexpected token '<'")
 * as if it were the report's, which tells the reader nothing about what went
 * wrong. Returning null instead hands the caller back to {@link httpFailure}.
 */
async function readJson(res: Response): Promise<PreviewEnvelope | null> {
  try {
    return (await res.json()) as PreviewEnvelope
  } catch {
    return null
  }
}

/** What to say when the response carried no error message of its own. */
function httpFailure(res: Response): string {
  if (res.status === 504 || res.status === 502 || res.status === 503) {
    return 'The report took too long to build and the server gave up. Try a narrower window, '
      + 'or a lower row limit — and check whether the Apple System is responding.'
  }
  if (res.status === 401 || res.status === 403) return 'Your session has expired — sign in again.'
  return `The server returned an unexpected response (HTTP ${res.status}).`
}

/** The window block both report shapes carry — everything the drawer chrome needs. */
interface PreviewWindow { label: string; fromDate: string; toDate: string; timezone: string; period?: string }

interface OpsPreviewData {
  window: PreviewWindow
  created: { total: number; channel: { b2b: number; b2c: number }; pax: number }
  split?: { available: boolean; todayCount: number; oldCount: number; appleCount: number }
  onGround: { total: number; pax: number }
  readiness: {
    total: number; notReady: number; tomorrow: number; hotelOnly: number
    drivers: { tours: number; allocated: number; partial: number; pending: number }
  }
  reconfirm: {
    total: number; breached: number; explained: number; unexplained: number
    status: { completed: number; pending: number; overdue: number }
  }
  complaints: { total: number; open: number; available: boolean }
  upcoming: { total: number; next7: number }
}

interface ReconcilePreviewData {
  window: PreviewWindow
  balanced: boolean
  findings: { severity: string }[]
  b2b: {
    as: { confirmed: number; unconfirmed: number; other: number; total: number }
    ops: { created: number; cancelled: number; held: number }
    check: { expected: number; ops: number; pnls: number; invoices: number; opsShort: number; pnlShort: number; invoiceShort: number }
  }
  b2c: { available: boolean; orders: number; withPnl: number; withInvoice: number }
}

interface Money { currency: string; total: number }

export interface SalesPreviewData {
  window: PreviewWindow & { days: number; custom: boolean; live: boolean; previous: { label: string } }
  bookings: { available: boolean; total: number; previousTotal: number | null; pax: number; value: Money[]; missing: number }
  invoices: { available: boolean; newCount: number; amendedCount: number; newValue: Money[] }
  store: { available: boolean; orders: number; value: Money[] }
  pipeline: {
    available: boolean
    team: { key: string; label: string } | null
    counts: {
      newQuotes: number; amendments: number; confirmations: number; conversion: number | null
      calls: { total: number; connected: number; rate: number | null }
      signups: { agencies: number; desk: number; pending: number }
      adoption: { prompts: number; activeAgencies: number }
    }
  }
  highlights: { severity: 'good' | 'watch' | 'warning' | 'critical'; title: string; detail: string }[]
  warnings: string[]
  sheets: string[]
}

interface Summary {
  reportType: ReportType
  subject: string
  data: OpsPreviewData | ReconcilePreviewData | SalesPreviewData
}

const moneyShort = (m: Money[] | undefined) =>
  m?.length ? `${m[0].currency} ${Math.round(m[0].total).toLocaleString()}${m.length > 1 ? ` +${m.length - 1}` : ''}` : 'no value'

export function salesStats(d: SalesPreviewData): StatTile[] {
  const c = d.pipeline.counts
  const p = d.pipeline.available
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
  return [
    { label: 'Bookings', value: d.bookings.total, sub: `${d.bookings.pax} guests${d.bookings.previousTotal !== null ? ` · ${d.bookings.previousTotal} before` : ''}` },
    { label: 'Invoiced new', value: d.invoices.newCount, sub: d.invoices.available ? moneyShort(d.invoices.newValue) : 'accounts unavailable' },
    { label: 'Quotations', value: p ? c.newQuotes : 0, sub: p ? `${c.amendments} amendments` : 'unavailable' },
    { label: 'Confirmed', value: p ? c.confirmations : 0, sub: p ? `${pct(c.conversion)} of quoted` : 'unavailable' },
    { label: 'Calls', value: p ? c.calls.total : 0, sub: p ? `${pct(c.calls.rate)} answered` : 'unavailable' },
    { label: 'New agencies', value: p ? c.signups.agencies : 0, sub: p ? `${c.signups.desk} onboarded by us` : 'unavailable' },
    { label: 'B2C orders', value: d.store.orders, sub: d.store.available ? moneyShort(d.store.value) : 'store unavailable' },
    { label: 'AI prompts', value: p ? c.adoption.prompts : 0, sub: p ? `${c.adoption.activeAgencies} agencies` : 'unavailable' },
  ]
}

interface StatTile { label: string; value: number; sub: string }

function opsStats(d: OpsPreviewData): StatTile[] {
  return [
    // Same rule as `todayNewAndUpdated()` (server-only module): the accounts
    // invoice mail's new + same-day-amended plus order confirmations edited.
    d.split?.available
      ? { label: 'Today new & updated', value: d.split.todayCount + d.split.oldCount, sub: `${d.split.todayCount} new + ${d.split.oldCount} amended` }
      : { label: 'Today new & updated', value: d.split?.appleCount || d.created.total, sub: `${d.created.channel.b2b} B2B · ${d.created.channel.b2c} B2C` },
    { label: 'On ground', value: d.onGround.total, sub: `${d.onGround.pax} guests` },
    {
      label: 'Next 3 days',
      value: d.readiness.total,
      // Cancelled and accommodation-only arrivals are left out of the count, so
      // the tile names them: a smaller number than yesterday is not lost data.
      sub: [
        `${d.readiness.notReady} not ready`,
        d.readiness.hotelOnly ? `${d.readiness.hotelOnly} hotel only left out` : null,
      ].filter(Boolean).join(' · '),
    },
    {
      label: 'D-3 drivers',
      value: d.readiness.drivers.allocated,
      sub: `of ${d.readiness.drivers.tours} allocated · ${d.readiness.drivers.partial + d.readiness.drivers.pending} need a driver`,
    },
    {
      label: 'Reconfirmed',
      value: d.reconfirm.status.completed,
      // Pending is the work; overdue is the part of it that has already missed D-10.
      sub: d.reconfirm.status.pending
        ? `${d.reconfirm.status.pending} pending · ${d.reconfirm.status.overdue} past D-10`
        : 'none pending',
    },
    { label: 'Complaints', value: d.complaints.total, sub: d.complaints.available ? `${d.complaints.open} open` : 'unavailable' },
    { label: 'Upcoming', value: d.upcoming.total, sub: `${d.upcoming.next7} in 7 days` },
  ]
}

function reconcileStats(d: ReconcilePreviewData): StatTile[] {
  const short = (n: number) => (n > 0 ? `${n} missing` : 'complete')
  return [
    { label: 'AS confirmed', value: d.b2b.as.confirmed, sub: `${d.b2b.as.unconfirmed} unconfirmed · ${d.b2b.as.other} other` },
    { label: 'OPS bookings', value: d.b2b.check.ops, sub: short(d.b2b.check.opsShort) },
    { label: 'P&Ls', value: d.b2b.check.pnls, sub: short(d.b2b.check.pnlShort) },
    { label: 'Invoices', value: d.b2b.check.invoices, sub: short(d.b2b.check.invoiceShort) },
    {
      label: 'B2C orders',
      value: d.b2c.available ? d.b2c.orders : 0,
      sub: d.b2c.available ? `${d.b2c.withInvoice} invoiced` : 'unavailable',
    },
    {
      label: 'Findings',
      value: d.findings.length,
      sub: d.balanced ? 'balanced' : 'NOT balanced',
    },
  ]
}

export default function PreviewDrawer({
  request, onClose,
}: {
  request: PreviewRequest | null
  onClose: () => void
}) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  // Empty = whatever the schedule would send right now. Held here rather than on
  // the request so stepping through days does not disturb the caller's draft.
  const [date, setDate] = useState('')
  // SALES only: a free range. Both empty = the schedule's own period.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => { setDate(request?.date ?? ''); setFrom(request?.from ?? ''); setTo(request?.to ?? '') }, [request])

  const query = useMemo(
    () => (request ? previewQuery({ ...request, date, from, to }) : ''),
    [request, date, from, to],
  )

  useEffect(() => {
    if (!request) { setSummary(null); setError(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/reports/auto/preview?${query}`)
      .then(async res => {
        const json = await readJson(res)
        if (!res.ok || !json?.success) throw new Error(json?.error || httpFailure(res))
        if (!cancelled) setSummary(json.data as Summary)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Preview failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [request, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (request) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [request, onClose])

  if (!request) return null

  const d = summary?.data
  // Which attachment this shape would actually send: every OPS report carries a
  // workbook, the reconciliation report a CSV.
  const csvOnly = (summary?.reportType ?? request.reportType ?? 'OPS') === 'RECONCILIATION'
  const isSales = (summary?.reportType ?? request.reportType) === 'SALES'
  // Stepping moves a whole period at a time, taken from the range the server
  // actually returned — so one click back on a weekly report is a whole week,
  // with no period arithmetic duplicated on the client.
  const tz = d?.window.timezone ?? 'Asia/Colombo'
  const maxDate = dateInTz(new Date(), tz)
  const canStepForward = !!d && d.window.toDate < maxDate
  const step = (dir: -1 | 1) => {
    if (!d) return
    // Stepping is by period, so it leaves any free range behind.
    setFrom(''); setTo('')
    setDate(dir === -1 ? shiftDate(d.window.fromDate, -1) : shiftDate(d.window.toDate, 1))
  }

  // The two report shapes share this drawer but not a single field beyond
  // `window`, so the strip is built from whichever shape the server said it is.
  const stats = !d
    ? []
    : summary?.reportType === 'SALES'
      ? salesStats(d as SalesPreviewData)
      : summary?.reportType === 'RECONCILIATION'
        ? reconcileStats(d as ReconcilePreviewData)
        : opsStats(d as OpsPreviewData)

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="flex-1 flex flex-col m-0 sm:m-4 bg-slate-100 sm:rounded-2xl overflow-hidden shadow-2xl">
        {/* Head */}
        <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Mail className="w-4 h-4 text-teal-600 flex-shrink-0" />
              <span className="truncate">{summary?.subject ?? request.title ?? 'Report preview'}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {d
                ? `${d.window.label} · times in ${d.window.timezone}${date ? ' · back-dated view' : ''}`
                : 'Building the report…'}
            </p>
          </div>

          {/* Report date — step by period, or pick any past day */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100">
            <button
              onClick={() => step(-1)}
              disabled={!d || loading}
              className="p-1.5 rounded-md text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              title="Previous period"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={date || d?.window.fromDate || ''}
              max={maxDate}
              onChange={e => { setFrom(''); setTo(''); setDate(e.target.value) }}
              className="bg-white rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              title="Report date"
            />
            <button
              onClick={() => step(1)}
              disabled={!d || loading || !canStepForward}
              className="p-1.5 rounded-md text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              title="Next period"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {(date || from || to) && (
              <button
                onClick={() => { setDate(''); setFrom(''); setTo('') }}
                className="p-1.5 rounded-md text-slate-500 hover:bg-white hover:text-slate-900 transition-colors"
                title="Back to the latest report"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {isSales && (
            <div className="hidden md:flex items-center gap-1 p-1 rounded-lg bg-indigo-50" title="Any date range — sales report only">
              <span className="px-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-500">Range</span>
              <input
                type="date" value={from} max={to || maxDate}
                onChange={e => setFrom(e.target.value)}
                className="bg-white rounded-md border border-indigo-200 px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <span className="text-indigo-300 text-xs">→</span>
              <input
                type="date" value={to} min={from || undefined} max={maxDate}
                onChange={e => setTo(e.target.value)}
                className="bg-white rounded-md border border-indigo-200 px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
          )}

          <div className="hidden sm:flex items-center gap-1 p-1 rounded-lg bg-slate-100">
            {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([mode, Icon]) => (
              <button
                key={mode}
                onClick={() => setDevice(mode)}
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  device === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600',
                )}
                title={`${mode} width`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>

          {/* OPS reports — daily, weekly and monthly — attach a multi-sheet
              workbook; the reconciliation report still attaches a CSV. */}
          <a
            href={`/api/reports/auto/preview?${query}&format=${csvOnly ? 'csv' : 'xlsx'}`}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> {csvOnly ? 'CSV' : 'Excel'}
          </a>

          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stat strip */}
        {stats.length > 0 && (
          <div className={cn('grid grid-cols-2 gap-px bg-slate-200 border-b border-slate-200', isSales ? 'sm:grid-cols-4 lg:grid-cols-8' : 'sm:grid-cols-5')}>
            {stats.map(s => (
              <div key={s.label} className="bg-white px-4 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.label}</div>
                <div className="text-xl font-extrabold text-slate-900 leading-tight">{s.value.toLocaleString()}</div>
                <div className="text-[11px] text-slate-500">{s.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto bg-slate-200/60 p-3 sm:p-6">
          {error ? (
            <div className="max-w-lg mx-auto mt-10 p-5 rounded-xl bg-white border border-red-200">
              <div className="flex items-center gap-2 text-red-600 font-semibold text-sm">
                <AlertTriangle className="w-4 h-4" /> Preview failed
              </div>
              <p className="text-sm text-slate-600 mt-2">{error}</p>
            </div>
          ) : loading && !summary ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className="text-sm">Collecting bookings, tours and complaints…</p>
            </div>
          ) : (
            <iframe
              key={query}
              title="Report preview"
              src={`/api/reports/auto/preview?${query}&format=html`}
              sandbox=""
              className={cn(
                'bg-white mx-auto block border border-slate-300 rounded-lg shadow-sm transition-all',
                device === 'mobile' ? 'w-[400px] max-w-full' : 'w-full max-w-[760px]',
              )}
              style={{ height: 'calc(100vh - 260px)', minHeight: 420 }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
