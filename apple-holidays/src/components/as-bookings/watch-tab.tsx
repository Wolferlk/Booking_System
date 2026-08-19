'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Radar, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  CalendarRange, Activity, Gauge, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { fmtDateTime } from './shared'
import { relTime, type WatchCheck, type WatchStatus, type WatchSettings } from './watch-shared'

const INTERVAL_PRESETS = [5, 10, 15, 30, 60] as const
const LOOKBACK_PRESETS = [1, 2, 3, 7, 14] as const

/** Re-renders once a second so countdowns stay live without refetching. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

export default function WatchTab() {
  const [status, setStatus]   = useState<WatchStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [customInterval, setCustomInterval] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const now = useTicker(true)

  const load = useCallback(async (quiet = false) => {
    try {
      const res  = await fetch('/api/as-bookings-v2/watch')
      const json = await readApiResponse<WatchStatus>(res)
      if (json.success && json.data) { setStatus(json.data); setError(null) }
      else if (!quiet) setError(json.error ?? 'Could not load watch status')
    } catch {
      if (!quiet) setError('Network error loading watch status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Keep the panel honest while it is open — the watch runs server-side, so
    // checks land whether or not anyone is looking.
    pollRef.current = setInterval(() => { void load(true) }, 20_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load])

  const save = useCallback(async (patch: Partial<WatchSettings>) => {
    if (!status) return
    const next = { ...status.settings, ...patch }
    setSaving(true)
    setStatus({ ...status, settings: next })   // optimistic
    try {
      const res = await fetch('/api/as-bookings-v2/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await readApiResponse<{ settings: WatchSettings }>(res)
      if (!json.success) { toast.error(json.error ?? 'Could not save'); await load(true) }
      else await load(true)
    } catch {
      toast.error('Network error saving settings')
      await load(true)
    } finally {
      setSaving(false)
    }
  }, [status, load])

  const fetchNow = useCallback(async () => {
    setFetching(true)
    try {
      const res  = await fetch('/api/as-bookings-v2/watch/run', { method: 'POST' })
      const json = await readApiResponse<{ ran: boolean; check?: WatchCheck; status: WatchStatus }>(res)
      if (!json.success) { toast.error(json.error ?? 'Fetch failed'); return }
      if (json.data?.status) setStatus(json.data.status)
      const created = json.data?.check?.created ?? 0
      if (json.data?.check?.error) toast.error(json.message ?? 'AppleSystem unreachable')
      else if (created > 0) toast.success(json.message ?? `${created} imported`)
      else toast.info(json.message ?? 'No new confirmations')
    } catch {
      toast.error('Network error during fetch')
    } finally {
      setFetching(false)
    }
  }, [])

  const s = status?.settings
  const enabled = !!s?.enabled

  const countdown = useMemo(() => {
    if (!status?.nextCheckAt || !enabled) return null
    const due = Date.parse(status.nextCheckAt) - now
    return due <= 0 ? 'due now' : relTime(due)
  }, [status?.nextCheckAt, enabled, now])

  const lastAge = status?.lastCheckAt ? relTime(now - Date.parse(status.lastCheckAt)) : null

  if (loading) {
    return (
      <Card className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* ── Radar hero ───────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="relative p-5 sm:p-6">
          {/* soft glow behind the radar when live */}
          {enabled && (
            <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
          )}

          <div className="relative flex flex-col sm:flex-row sm:items-start justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                {enabled && (
                  <>
                    <span className="absolute inset-0 rounded-2xl bg-emerald-400/30 animate-ping" />
                    <span className="absolute -inset-1 rounded-2xl bg-emerald-400/10" />
                  </>
                )}
                <div className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                  enabled ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25' : 'bg-slate-100 text-slate-400'
                }`}>
                  <Radar className={`w-6 h-6 ${status?.running ? 'animate-spin' : ''}`} />
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900">Live confirmation watch</h3>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    status?.running ? 'bg-brand-100 text-brand-700'
                      : enabled     ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-100 text-slate-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      status?.running ? 'bg-brand-500 animate-pulse'
                        : enabled     ? 'bg-emerald-500 animate-pulse'
                                      : 'bg-slate-400'
                    }`} />
                    {status?.running ? 'Checking' : enabled ? 'Live' : 'Paused'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 max-w-lg leading-relaxed">
                  Keeps asking AppleSystem for newly <span className="font-medium">confirmed (Status&nbsp;2)</span>{' '}
                  quotations and creates the booking here within minutes — instead of waiting for the
                  6&nbsp;AM job to pick it up the next morning. Runs on the server, so it works with
                  nobody logged in.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={fetchNow}
                disabled={fetching}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${fetching ? 'animate-spin text-brand-500' : 'text-slate-400'}`} />
                {fetching ? 'Checking…' : 'Fetch now'}
              </button>

              <button
                role="switch"
                aria-checked={enabled}
                aria-label="Toggle live confirmation watch"
                disabled={saving}
                onClick={() => save({ enabled: !enabled })}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                  enabled ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          </div>

          {/* ── Pulse row ───────────────────────────────────────────────── */}
          <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100">
            <Metric
              icon={<Clock className="w-3.5 h-3.5" />}
              label="Last checked"
              value={lastAge ? `${lastAge} ago` : 'Never'}
              hint={status?.lastCheckAt ? fmtDateTime(status.lastCheckAt) : 'No check has run yet'}
            />
            <Metric
              icon={<Gauge className="w-3.5 h-3.5" />}
              label="Next check"
              value={enabled ? (countdown ?? `in ${s?.intervalMinutes}m`) : 'Paused'}
              hint={enabled ? `Every ${s?.intervalMinutes} minutes` : 'Switch the watch on to resume'}
              tone={enabled ? 'live' : 'muted'}
            />
            <Metric
              icon={<Sparkles className="w-3.5 h-3.5" />}
              label="Created"
              value={String(status?.totals.created ?? 0)}
              hint={`Across the last ${status?.totals.checks ?? 0} checks`}
              tone={(status?.totals.created ?? 0) > 0 ? 'good' : 'muted'}
            />
            <Metric
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
              label="Problems"
              value={String(status?.totals.errors ?? 0)}
              hint={(status?.totals.errors ?? 0) > 0 ? 'Retried on the next check' : 'No failures recorded'}
              tone={(status?.totals.errors ?? 0) > 0 ? 'bad' : 'muted'}
            />
          </div>
        </div>
      </Card>

      {/* ── Tuning ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-900">How often to check</h4>
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            A quiet check costs one AppleSystem request — confirmations already in the system are
            filtered out before any detail is fetched, so a short interval is cheap.
          </p>

          <div className="flex flex-wrap gap-2 mt-4">
            {INTERVAL_PRESETS.map((m) => {
              const on = s?.intervalMinutes === m
              return (
                <button
                  key={m}
                  disabled={saving}
                  onClick={() => { setCustomInterval(''); void save({ intervalMinutes: m }) }}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition-all disabled:opacity-50 ${
                    on ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-sm'
                       : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {m < 60 ? `${m} min` : '1 hour'}
                </button>
              )
            })}

            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5">
              <input
                type="number"
                min={2}
                max={720}
                placeholder="Custom"
                value={customInterval}
                onChange={(e) => setCustomInterval(e.target.value)}
                onBlur={() => {
                  const n = parseInt(customInterval, 10)
                  if (Number.isFinite(n) && n >= 2 && n <= 720 && n !== s?.intervalMinutes) {
                    void save({ intervalMinutes: n })
                  }
                }}
                className="w-16 bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:font-normal placeholder:text-slate-400"
              />
              <span className="text-xs text-slate-400">min</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            Anything from 2 to 720 minutes. Changes apply immediately — no restart.
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-900">How far back to sweep</h4>
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            AppleSystem filters by the quotation&apos;s <span className="font-medium">create date</span>, not
            when it was confirmed. Re-sweeping the last few days is what catches a quote created
            earlier and only confirmed today — the case the daily job misses entirely.
          </p>

          <div className="flex flex-wrap gap-2 mt-4">
            {LOOKBACK_PRESETS.map((d) => {
              const on = s?.lookbackDays === d
              return (
                <button
                  key={d}
                  disabled={saving}
                  onClick={() => void save({ lookbackDays: d })}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition-all disabled:opacity-50 ${
                    on ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-sm'
                       : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {d === 1 ? 'Today only' : `${d} days`}
                </button>
              )
            })}
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Current window</p>
            <p className="text-sm font-semibold text-slate-700 tabular-nums mt-0.5">
              {status?.window.from} → {status?.window.to}
              <span className="ml-2 font-normal text-xs text-slate-400">{status?.timezone}</span>
            </p>
          </div>
        </Card>
      </div>

      {/* ── Activity ─────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-900">Recent checks</h4>
          </div>
          {status && status.checks.length > 0 && (
            <ActivityStrip checks={status.checks} />
          )}
        </div>

        {!status?.checks.length ? (
          <p className="text-sm text-slate-400 mt-4">
            No checks yet. Switch the watch on, or press <span className="font-medium text-slate-500">Fetch now</span>.
          </p>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {status.checks.map((c) => <CheckRow key={c.at} check={c} now={now} />)}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Metric({
  icon, label, value, hint, tone = 'muted',
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  tone?: 'muted' | 'good' | 'bad' | 'live'
}) {
  const valueTone = {
    muted: 'text-slate-900',
    good:  'text-emerald-600',
    bad:   'text-amber-600',
    live:  'text-brand-600',
  }[tone]
  return (
    <div title={hint}>
      <div className="flex items-center gap-1.5 text-slate-400">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-lg font-bold tabular-nums leading-tight mt-1 ${valueTone}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{hint}</p>}
    </div>
  )
}

/**
 * A dense bar-per-check strip, newest on the right — the shape of the last few
 * hours at a glance: grey for a quiet check, green scaled by how many bookings
 * it created, amber when something failed.
 */
function ActivityStrip({ checks }: { checks: WatchCheck[] }) {
  const ordered = [...checks].reverse()
  const peak = Math.max(1, ...ordered.map((c) => c.created))
  return (
    <div className="flex items-end gap-[3px] h-8" aria-hidden>
      {ordered.map((c) => {
        const bad = !!c.error || c.errors > 0
        const h = c.created > 0 ? 25 + (c.created / peak) * 75 : 14
        return (
          <span
            key={c.at}
            title={`${fmtDateTime(c.at)} — ${c.created} created${bad ? ', had errors' : ''}`}
            style={{ height: `${h}%` }}
            className={`w-1.5 rounded-full ${
              bad ? 'bg-amber-400' : c.created > 0 ? 'bg-emerald-500' : 'bg-slate-200'
            }`}
          />
        )
      })}
    </div>
  )
}

function CheckRow({ check: c, now }: { check: WatchCheck; now: number }) {
  const bad     = !!c.error
  const partial = !bad && c.errors > 0
  const made    = c.created > 0

  const tone = bad ? 'bg-red-50/70 border-red-100'
    : partial   ? 'bg-amber-50/70 border-amber-100'
    : made      ? 'bg-emerald-50/70 border-emerald-100'
                : 'bg-white border-slate-100'

  return (
    <li className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${tone}`}>
      <span className="mt-0.5 shrink-0">
        {bad     ? <AlertTriangle className="w-4 h-4 text-red-500" />
         : made  ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
         : partial ? <AlertTriangle className="w-4 h-4 text-amber-500" />
                   : <span className="block w-4 h-4 flex items-center justify-center">
                       <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                     </span>}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-700">
          {bad
            ? <span className="text-red-700">Check failed — {c.error}</span>
            : made
              ? <>
                  <span className="font-semibold text-emerald-700">
                    {c.created} booking{c.created === 1 ? '' : 's'} created
                  </span>
                  {c.refs.length > 0 && (
                    <span className="ml-1.5 text-slate-500 tabular-nums">{c.refs.join(', ')}</span>
                  )}
                </>
              : <span className="text-slate-500">
                  Nothing new — {c.found} confirmation{c.found === 1 ? '' : 's'} in window, all already imported
                </span>}
          {partial && (
            <span className="ml-1.5 text-amber-700">· {c.errors} failed, will retry</span>
          )}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
          {relTime(now - Date.parse(c.at))} ago · {fmtDateTime(c.at)} · {c.windowFrom} → {c.windowTo}
          {' · '}{(c.durationMs / 1000).toFixed(1)}s
          {c.trigger === 'manual' && ' · manual'}
        </p>
      </div>
    </li>
  )
}
