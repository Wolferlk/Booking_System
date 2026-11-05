'use client'

/**
 * Sales Report studio — the Daily Sales Report for any day or any range.
 *
 * The scheduled mail goes out from Auto Reports; this page answers the
 * questions in between: "what did last Tuesday look like", "how did the
 * Bangalore desk do this month", "send the directors 1–15 October". It reads
 * the same `/api/reports/auto/preview` endpoint the mailer renders from, so the
 * iframe below is literally the email and the Excel button is literally the
 * attachment. Nothing on this page writes to any booking, quote or invoice.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  AlertTriangle, Bot, CalendarRange, CheckCircle2, Download, Eye, Globe2, Loader2, Mail,
  Monitor, Send, Smartphone, Sparkles, TrendingUp, Users,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { cn, readApiResponse } from '@/lib/utils'
import { dateInTz, shiftDate } from '@/lib/reports/report-window'
import { previewQuery, salesStats, type SalesPreviewData } from '../auto/preview-drawer'
import { COUNTRY_OPTIONS, SALES_TEAM_OPTIONS, type AutoReportPayload, type Schedule } from '../auto/types'

const TZ = 'Asia/Colombo'

type PresetKey = 'yesterday' | 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'custom'

function presetRange(key: PresetKey, today: string): { from: string; to: string } | null {
  const monthStart = `${today.slice(0, 7)}-01`
  switch (key) {
    case 'yesterday': { const y = shiftDate(today, -1); return { from: y, to: y } }
    case 'today': return { from: today, to: today }
    case 'last7': return { from: shiftDate(today, -7), to: shiftDate(today, -1) }
    case 'thisMonth': return { from: monthStart, to: today }
    case 'lastMonth': { const end = shiftDate(monthStart, -1); return { from: `${end.slice(0, 7)}-01`, to: end } }
    default: return null
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'today', label: 'Today so far' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
]

const SEVERITY: Record<SalesPreviewData['highlights'][number]['severity'], { cls: string; word: string }> = {
  critical: { cls: 'border-red-200 bg-red-50 text-red-800', word: 'Act now' },
  warning: { cls: 'border-amber-200 bg-amber-50 text-amber-800', word: 'Attention' },
  watch: { cls: 'border-blue-200 bg-blue-50 text-blue-800', word: 'Watch' },
  good: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', word: 'Going well' },
}

interface Envelope { reportType: string; subject: string; data: SalesPreviewData }

export default function SalesReportPage() {
  const today = useMemo(() => dateInTz(new Date(), TZ), [])
  const [preset, setPreset] = useState<PresetKey>('yesterday')
  const [from, setFrom] = useState(() => shiftDate(today, -1))
  const [to, setTo] = useState(() => shiftDate(today, -1))
  const [team, setTeam] = useState('')
  const [countries, setCountries] = useState<string[]>([])
  const [aiSummary, setAiSummary] = useState(false)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')

  // The query actually rendered — only moves when Generate is pressed, so
  // fiddling with the controls does not rebuild a four-system report each click.
  const [query, setQuery] = useState<string | null>(null)
  const [result, setResult] = useState<Envelope | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [scheduleId, setScheduleId] = useState('')
  const [sending, setSending] = useState<'test' | 'live' | null>(null)
  const [confirmLive, setConfirmLive] = useState(false)

  useEffect(() => {
    fetch('/api/reports/auto')
      .then(res => readApiResponse<AutoReportPayload>(res))
      .then(json => {
        const sales = (json.data?.schedules ?? []).filter(s => s.reportType === 'SALES')
        setSchedules(sales)
        if (sales[0]) setScheduleId(sales[0].id)
      })
      .catch(() => { /* the page still works without schedules — only sending needs one */ })
  }, [])

  const pickPreset = (key: PresetKey) => {
    setPreset(key)
    const r = presetRange(key, today)
    if (r) { setFrom(r.from); setTo(r.to) }
  }

  const buildQuery = useCallback(() => previewQuery({
    reportType: 'SALES',
    period: 'DAILY',
    timezone: TZ,
    countries,
    aiSummary,
    maxRows: 40,
    team: team || null,
    from,
    to,
  }), [countries, aiSummary, team, from, to])

  const generate = useCallback(() => {
    if (!from || !to) { toast.error('Pick a start and an end date.'); return }
    if (from > to) { toast.error('The start date is after the end date.'); return }
    setQuery(buildQuery())
  }, [buildQuery, from, to])

  // First load: yesterday, whole company.
  useEffect(() => { generate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!query) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/reports/auto/preview?${query}`)
      .then(async res => {
        const json = await readApiResponse<Envelope>(res)
        if (!json.success || !json.data) throw new Error(json.error || `The server returned HTTP ${res.status}.`)
        if (!cancelled) setResult(json.data)
      })
      .catch(err => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Could not build the report'); setResult(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query])

  const send = useCallback(async (mode: 'test' | 'live') => {
    if (!scheduleId) return
    setSending(mode)
    try {
      const res = await fetch('/api/reports/auto/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scheduleId, mode, from, until: to }),
      })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error || 'The report could not be sent.')
      toast.success(json.message || 'Report sent')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The report could not be sent.')
    } finally {
      setSending(null)
      setConfirmLive(false)
    }
  }, [scheduleId, from, to])

  const d = result?.data
  const stats = d ? salesStats(d) : []
  const schedule = schedules.find(s => s.id === scheduleId)
  const days = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : 0

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title={<span className="inline-flex items-center gap-2"><TrendingUp className="w-5 h-5 text-indigo-600" />Sales Report</span>}
        subtitle="B2C store orders, B2C bookings, quotations, calls, signups and the team — any day or any range"
        actions={
          <Link
            href="/dashboard/reports/auto"
            className="px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-white transition-colors inline-flex items-center gap-2"
          >
            <Mail className="w-4 h-4" /> Schedules
          </Link>
        }
      />

      <div className="p-4 sm:p-6 space-y-4 max-w-[1500px] mx-auto">
        {/* Controls */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="w-4 h-4 text-indigo-500" />
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => pickPreset(p.key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                  preset === p.key ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[auto_1fr_auto] items-end">
            <div className="flex items-end gap-2">
              <label className="text-xs font-semibold text-slate-500">
                From
                <input
                  type="date" value={from} max={to || today}
                  onChange={e => { setPreset('custom'); setFrom(e.target.value) }}
                  className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </label>
              <span className="pb-2.5 text-slate-300">→</span>
              <label className="text-xs font-semibold text-slate-500">
                To
                <input
                  type="date" value={to} min={from || undefined} max={today}
                  onChange={e => { setPreset('custom'); setTo(e.target.value) }}
                  className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </label>
              <span className="pb-2.5 text-xs text-slate-400 whitespace-nowrap">{days > 0 ? `${days} day${days === 1 ? '' : 's'}` : ''}</span>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="text-xs font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Travel Quote GPT team</span>
                <select
                  value={team}
                  onChange={e => setTeam(e.target.value)}
                  className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                >
                  {SALES_TEAM_OPTIONS.map(t => <option key={t.value || 'all'} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <div className="text-xs font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1"><Globe2 className="w-3.5 h-3.5" /> Booking markets</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setCountries([])}
                    className={cn('px-2.5 py-1.5 rounded-lg border text-xs font-semibold', !countries.length ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600')}
                  >All</button>
                  {COUNTRY_OPTIONS.map(c => {
                    const on = countries.includes(c.value)
                    return (
                      <button
                        key={c.value}
                        onClick={() => setCountries(cur => on ? cur.filter(x => x !== c.value) : [...cur, c.value])}
                        className={cn('px-2.5 py-1.5 rounded-lg border text-xs font-semibold', on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600')}
                      >{c.label}</button>
                    )
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 self-end pb-2 cursor-pointer">
                <input type="checkbox" checked={aiSummary} onChange={e => setAiSummary(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
                <Bot className="w-3.5 h-3.5 text-slate-400" /> AI summary
              </label>
            </div>

            <button
              onClick={generate}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-teal-600 text-white text-sm font-bold shadow-sm hover:opacity-95 disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate report
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Read-only, B2C only: orders from the Aahaas store (test orders excluded), B2C bookings from this system, and
            quotations, calls and signups from Travel Quote GPT. A range is compared with the same number of days just before it.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-white border border-red-200 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-red-700">The report could not be built</div>
              <p className="text-sm text-slate-600 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Stats */}
        {d && (
          <div className={cn('transition-opacity', loading && 'opacity-50')}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <div>
                <div className="text-sm font-bold text-slate-900">{result?.subject}</div>
                <div className="text-xs text-slate-500">
                  {d.window.label} · compared with {d.window.previous.label}
                  {d.pipeline.team ? ` · ${d.pipeline.team.label}` : ''}
                  {d.window.live ? ' · still moving' : ''}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-px bg-slate-200 rounded-2xl overflow-hidden border border-slate-200">
              {stats.map(s => (
                <div key={s.label} className="bg-white px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.label}</div>
                  <div className="text-2xl font-extrabold text-slate-900 leading-tight">{s.value.toLocaleString()}</div>
                  <div className="text-[11px] text-slate-500 truncate" title={s.sub}>{s.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {d && (
          <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
            {/* Side panel: highlights, warnings, actions */}
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-2"><Eye className="w-4 h-4 text-red-500" /> Where to look</div>
                <div className="mt-3 space-y-2">
                  {d.highlights.map((h, i) => (
                    <div key={i} className={cn('rounded-lg border px-3 py-2', SEVERITY[h.severity].cls)}>
                      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{SEVERITY[h.severity].word}</div>
                      <div className="text-sm font-semibold leading-snug">{h.title}</div>
                      <div className="text-xs opacity-80 mt-0.5 leading-relaxed">{h.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              {d.warnings.length > 0 && (
                <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4">
                  <div className="text-sm font-bold text-amber-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Incomplete sources</div>
                  <ul className="mt-2 space-y-1 text-xs text-amber-800 list-disc pl-4">
                    {d.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                  <p className="mt-2 text-[11px] text-amber-700">A figure that could not be read shows “—”, never 0.</p>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="text-sm font-bold text-slate-900">Take it with you</div>
                <a
                  href={query ? `/api/reports/auto/preview?${query}&format=xlsx` : '#'}
                  className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 inline-flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Download Excel workbook
                </a>
                {d.sheets.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.sheets.map(s => <span key={s} className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-semibold text-slate-600">{s}</span>)}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">Email it</div>
                  {schedules.length ? (
                    <>
                      <select
                        value={scheduleId}
                        onChange={e => setScheduleId(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                      >
                        {schedules.map(s => <option key={s.id} value={s.id}>{s.name} · {s.to.length + s.cc.length} recipients</option>)}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-400">Uses that schedule&apos;s recipients, team and sections, with the dates chosen above.</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => void send('test')}
                          disabled={!!sending}
                          className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          {sending === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Send me a test
                        </button>
                        {confirmLive ? (
                          <button
                            onClick={() => void send('live')}
                            disabled={!!sending}
                            className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            {sending === 'live' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirm send
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmLive(true)}
                            disabled={!!sending}
                            className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            <Send className="w-4 h-4" /> Send to list
                          </button>
                        )}
                      </div>
                      {confirmLive && schedule && (
                        <p className="mt-2 text-[11px] text-red-600">
                          This emails {schedule.to.length + schedule.cc.length + schedule.bcc.length} people: {[...schedule.to, ...schedule.cc].slice(0, 4).join(', ')}
                          {schedule.to.length + schedule.cc.length > 4 ? '…' : ''}. It does not move the schedule&apos;s next send.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">
                      No sales schedule yet. <Link href="/dashboard/reports/auto" className="font-semibold text-indigo-600 hover:underline">Create one in Auto Reports</Link> —
                      choose <b>Sales report</b>, add the recipients, and it will go out every morning.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* The email itself */}
            <div className="bg-slate-200/60 rounded-2xl p-3 sm:p-5 border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> The email, exactly as it is sent</div>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-white/70">
                  {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([mode, Icon]) => (
                    <button
                      key={mode}
                      onClick={() => setDevice(mode)}
                      className={cn('p-1.5 rounded-md', device === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600')}
                      title={`${mode} width`}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>
              {query && (
                <iframe
                  key={query}
                  title="Sales report preview"
                  src={`/api/reports/auto/preview?${query}&format=html`}
                  sandbox=""
                  className={cn(
                    'bg-white mx-auto block border border-slate-300 rounded-lg shadow-sm transition-all',
                    device === 'mobile' ? 'w-[400px] max-w-full' : 'w-full max-w-[760px]',
                  )}
                  style={{ height: 'calc(100vh - 220px)', minHeight: 560 }}
                />
              )}
            </div>
          </div>
        )}

        {loading && !d && (
          <div className="py-24 flex flex-col items-center justify-center text-slate-400 gap-3">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm">Reading the store, B2C bookings and Travel Quote GPT…</p>
          </div>
        )}
      </div>
    </div>
  )
}
