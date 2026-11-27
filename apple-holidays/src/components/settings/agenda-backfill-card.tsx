'use client'

/**
 * Settings → Create Missing Agendas.
 *
 * Pick an arrival-date range, see how many upcoming files have no movement
 * chart, and start a background job that builds every empty one with the same
 * AI generation the agenda page uses. The job runs on the server (agenda
 * auto-generate scheduler, every 30 s), so this page can be closed. Charts
 * someone already saved are never touched. See lib/agenda-backfill.ts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarRange, CheckCircle2, ExternalLink, Eye, EyeOff, Loader2, Play, RefreshCw, Square, Wand2, XCircle,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

type Row = {
  bookingRef: string
  arrivalDate: string
  status: string
  country: string | null
  agent: string | null
  reason: 'hotel-only' | 'no-itinerary' | null
  autogen: { state: string; attempts: number; error: string | null; trigger: string } | null
}

type Summary = {
  from: string; to: string
  arrivals: number; withAgenda: number; missing: number; buildable: number
  hotelOnly: number; noItinerary: number; gaveUpBefore: number; estimatedTokens: number
  byMonth: { month: string; missing: number; buildable: number }[]
  rows: Row[]; rowsTruncated: boolean
}

type Job = {
  state: 'running' | 'stopped' | 'finished'
  from: string; to: string; total: number
  startedAt: string; startedBy: string; finishedAt?: string | null; stoppedBy?: string | null
}

type Progress = {
  built: number; failed: number; retrying: number; waiting: number; alreadyHad: number
  running: string[]; remaining: number
  recent: { bookingRef: string; state: string; items?: number; error?: string | null; at: string }[]
}

type Payload = {
  summary: Summary | null
  job: Job | null
  progress: Progress | null
  disabled: boolean
  concurrency: number
  tokensPerChart: number
}

const DAY = 86_400_000
// Local calendar date — the desk thinks in its own day, not UTC's.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => ymd(new Date())
const plus = (days: number) => ymd(new Date(Date.now() + days * DAY))
const fmt = (n: number) => n.toLocaleString('en-US')
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

const PRESETS: { label: string; days: number }[] = [
  { label: 'Next 7 days', days: 7 },
  { label: 'Next 30 days', days: 30 },
  { label: 'Next 90 days', days: 90 },
  { label: 'All upcoming', days: 399 },
]

export default function AgendaBackfillCard() {
  const [from, setFrom]         = useState(today())
  const [to, setTo]             = useState(plus(30))
  const [data, setData]         = useState<Payload | null>(null)
  const [loading, setLoading]   = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [filter, setFilter]     = useState<'all' | 'buildable' | 'skipped' | 'failed'>('all')

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const json = await fetch(`/api/admin/agenda-backfill?from=${from}&to=${to}`).then(r => r.json())
      if (!json.success) throw new Error(json.error)
      setData(json.data)
    } catch (err) {
      if (!quiet) toast.error(err instanceof Error ? err.message : 'Could not load agendas')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [from, to])

  // Re-count whenever the range changes (debounced so typing a date doesn't spam).
  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 350)
    return () => window.clearTimeout(t)
  }, [load])

  const running = data?.job?.state === 'running'

  // While a job runs, refresh quietly so the progress bar moves.
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => { void load(true) }, 15_000)
    return () => window.clearInterval(t)
  }, [running, load])

  async function start() {
    const s = data?.summary
    if (!s || s.buildable === 0) return
    if (!password.trim()) { toast.error('Enter the critical services password first'); return }
    const ok = window.confirm(
      `Build ${fmt(s.buildable)} missing agenda${s.buildable === 1 ? '' : 's'} for arrivals ${s.from} → ${s.to}?\n\n` +
      `• One GPT-4o call per booking (≈ ${fmt(s.estimatedTokens)} tokens in total)\n` +
      `• Runs in the background, nearest arrival first\n` +
      `• Only empty charts are filled — saved agendas are never changed`,
    )
    if (!ok) return
    setStarting(true)
    try {
      const res = await fetch('/api/admin/agenda-backfill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, password }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Started')
      await load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start')
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    setStopping(true)
    try {
      const json = await fetch('/api/admin/agenda-backfill', { method: 'DELETE' }).then(r => r.json())
      if (!json.success) throw new Error(json.error)
      toast.success('Stopped — agendas already built are kept')
      await load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not stop')
    } finally {
      setStopping(false)
    }
  }

  const s = data?.summary ?? null
  const job = data?.job ?? null
  const p = data?.progress ?? null

  const rows = useMemo(() => {
    const all = s?.rows ?? []
    if (filter === 'buildable') return all.filter(r => !r.reason)
    if (filter === 'skipped') return all.filter(r => r.reason)
    if (filter === 'failed') return all.filter(r => r.autogen?.state === 'failed')
    return all
  }, [s, filter])

  const done = p ? p.built + p.failed + p.alreadyHad + p.waiting : 0
  const pct = job && job.total > 0 ? Math.min(100, Math.round((done / job.total) * 100)) : 0
  // ~40 s per chart, `concurrency` at a time, plus the 30 s tick.
  const etaMin = p && data ? Math.ceil((p.remaining / Math.max(1, data.concurrency)) * 70 / 60) : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full gap-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-500" /> Create Missing Agendas
          </h3>
          {s && (
            <span className={`text-xs font-medium ${s.missing ? 'text-amber-700' : 'text-emerald-600'}`}>
              {fmt(s.missing)} of {fmt(s.arrivals)} arrivals have no agenda
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="p-5 space-y-5">
        <p className="text-sm text-slate-600">
          Pick an <strong>arrival-date</strong> range to see which files have no movement chart, then build all of them
          automatically with AI. It runs on the server in the background ({data?.concurrency ?? 3} at a time, nearest
          arrival first), so you can close this page. Only <em>empty</em> charts are filled — an agenda someone already
          saved is never changed. Cancelled and Hotel Only files are skipped.
        </p>

        {data?.disabled && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Agenda auto-generate is switched off on this server (<code>AGENDA_AUTOGEN_SWEEP=off</code>), so a job cannot run.
          </p>
        )}

        {/* Range */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500 space-y-1">
            <span className="block font-medium">Arrival from</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </label>
          <label className="text-xs text-slate-500 space-y-1">
            <span className="block font-medium">Arrival to</span>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(pr => (
              <button key={pr.label} onClick={() => { setFrom(today()); setTo(plus(pr.days)) }}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                {pr.label}
              </button>
            ))}
          </div>
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-check
          </button>
        </div>

        {/* Counts */}
        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Stat label="Arrivals in range" value={s.arrivals} />
            <Stat label="Agenda created" value={s.withAgenda} tone="good" />
            <Stat label="No agenda" value={s.missing} tone={s.missing ? 'warn' : 'good'} />
            <Stat label="Can be built now" value={s.buildable} tone="accent" />
            <Stat label="Hotel Only (skipped)" value={s.hotelOnly} />
            <Stat label="No itinerary (skipped)" value={s.noItinerary} />
          </div>
        )}

        {s && s.byMonth.length > 1 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {s.byMonth.map(m => (
              <span key={m.month} className="px-2 py-1 rounded-md bg-slate-100 text-slate-600">
                {new Date(`${m.month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}:{' '}
                <strong className="text-slate-800">{fmt(m.missing)}</strong> missing
              </span>
            ))}
          </div>
        )}

        {/* Start */}
        {s && !running && (
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-purple-200 bg-purple-50/60">
            <div className="relative w-72 max-w-full">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Critical services password"
                className="w-full px-3 py-1.5 pr-8 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-300" />
              <button onClick={() => setShowPw(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button onClick={start} disabled={starting || s.buildable === 0 || !!data?.disabled}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors">
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {s.buildable ? `Create ${fmt(s.buildable)} missing agenda${s.buildable === 1 ? '' : 's'}` : 'Nothing to create'}
            </button>
            {s.buildable > 0 && (
              <span className="text-xs text-purple-800">
                ≈ {fmt(s.estimatedTokens)} GPT-4o tokens
                {s.gaveUpBefore > 0 && <> · includes {fmt(s.gaveUpBefore)} the auto-sweep gave up on earlier</>}
              </span>
            )}
          </div>
        )}

        {/* Job */}
        {job && p && (
          <div className={`p-4 rounded-xl border space-y-3 ${running ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                {running ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  : job.state === 'finished' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  : <Square className="w-4 h-4 text-slate-500" />}
                {running ? 'Building agendas…' : job.state === 'finished' ? 'Last job finished' : 'Last job stopped'}
                <span className="font-normal text-slate-500 flex items-center gap-1">
                  <CalendarRange className="w-3.5 h-3.5" /> arrivals {job.from} → {job.to}
                </span>
              </p>
              {running && (
                <button onClick={stop} disabled={stopping}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
                  {stopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />} Stop
                </button>
              )}
            </div>
            <div className="h-2 rounded-full bg-white border border-slate-200 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-slate-600">
              <strong className="text-slate-900">{fmt(p.built)}</strong> built of {fmt(job.total)} ·{' '}
              <span className={p.failed ? 'text-red-700 font-semibold' : ''}>{fmt(p.failed)} failed</span>
              {p.retrying > 0 && <> · {fmt(p.retrying)} retrying</>}
              {p.waiting > 0 && <> · {fmt(p.waiting)} no usable itinerary</>}
              {p.alreadyHad > 0 && <> · {fmt(p.alreadyHad)} saved by hand meanwhile</>}
              {running && p.remaining > 0 && <> · ~{fmt(p.remaining)} left (≈ {etaMin < 90 ? `${etaMin} min` : `${Math.round(etaMin / 60)} h`})</>}
            </p>
            <p className="text-[11px] text-slate-400">
              Started {when(job.startedAt)} by {job.startedBy}
              {job.finishedAt && <> · {job.state === 'stopped' ? `stopped by ${job.stoppedBy ?? '—'}` : 'finished'} {when(job.finishedAt)}</>}
              {p.running.length > 0 && <> · now: {p.running.join(', ')}</>}
            </p>
            {p.recent.length > 0 && (
              <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto">
                {p.recent.map(r => (
                  <li key={r.bookingRef} className="flex items-center gap-2">
                    {r.state === 'done' ? <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      : r.state === 'failed' ? <XCircle className="w-3 h-3 text-red-500" />
                      : <Loader2 className="w-3 h-3 text-slate-400" />}
                    <a href={`/dashboard/bookings/${encodeURIComponent(r.bookingRef)}/agenda`} target="_blank" rel="noreferrer"
                      className="font-mono font-semibold text-slate-800 hover:underline">{r.bookingRef}</a>
                    <span className="text-slate-500 truncate">
                      {r.state === 'done' ? `${r.items ?? 0} movements` : r.state === 'failed' ? (r.error ?? 'failed') : r.state}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* List */}
        {s && s.missing > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {([
                ['all', `All (${fmt(s.missing)})`],
                ['buildable', `Can build (${fmt(s.buildable)})`],
                ['skipped', `Skipped (${fmt(s.hotelOnly + s.noItinerary)})`],
                ['failed', 'Failed before'],
              ] as const).map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`px-2.5 py-1 rounded-full border ${filter === k ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {label}
                </button>
              ))}
              {s.rowsTruncated && <span className="text-slate-400">showing the first 300 by arrival</span>}
            </div>
            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Booking</th>
                    <th className="text-left px-3 py-2 font-medium">Arrival</th>
                    <th className="text-left px-3 py-2 font-medium">Country</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Agenda</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => (
                    <tr key={r.bookingRef} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5">
                        <a href={`/dashboard/bookings/${encodeURIComponent(r.bookingRef)}/agenda`} target="_blank" rel="noreferrer"
                          className="font-mono font-semibold text-slate-800 hover:underline inline-flex items-center gap-1">
                          {r.bookingRef} <ExternalLink className="w-3 h-3 text-slate-400" />
                        </a>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{r.arrivalDate}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.country ?? '—'}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.status.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-1.5">
                        {r.reason === 'hotel-only' ? <span className="text-slate-400">Hotel Only — waived</span>
                          : r.reason === 'no-itinerary' ? <span className="text-amber-700">No itinerary to build from</span>
                          : r.autogen?.state === 'running' ? <span className="text-blue-600">Building…</span>
                          : r.autogen?.state === 'failed' ? <span className="text-red-600" title={r.autogen.error ?? ''}>Failed ×{r.autogen.attempts}</span>
                          : <span className="text-purple-700">Not created</span>}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">Nothing in this filter</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' | 'accent' }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'accent' ? 'text-purple-700' : 'text-slate-900'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{fmt(value)}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  )
}
