'use client'

/**
 * Pre-Arrival Sync settings tab.
 *
 * One switch plus one number: how many days before arrival every live booking is
 * refreshed from AppleSystem. The job runs server-side on a daily timer, so this
 * panel is purely the control surface — it shows the date the next run will
 * target, how many bookings that currently covers, and the last few runs.
 *
 * The heavy caveats live in `src/lib/as-booking-sync.ts`: the sync rewrites
 * booking *content* only and never workflow state, which is what makes running
 * it unattended on live files acceptable in the first place. That promise is
 * restated in the UI because it is the whole reason ops can leave it switched on.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarClock, Loader2, RefreshCw, AlertTriangle, ShieldCheck,
  Clock, CalendarDays, CheckCircle2, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { fmtDateTime } from './shared'

const DAY_PRESETS = [1, 2, 3, 5, 7] as const
const MIN_DAYS = 0
const MAX_DAYS = 60

interface PreSyncSettings {
  enabled: boolean
  daysBefore: number
  hour: number
  minute: number
}

interface PreSyncDetail {
  bookingRef: string
  status: 'updated' | 'unchanged' | 'failed'
  changed?: string[]
  error?: string
}

interface PreSyncRun {
  at: string
  mode: 'auto' | 'manual'
  targetDate: string
  daysBefore: number
  scanned: number
  updated: number
  unchanged: number
  failed: number
  durationMs: number
  capped?: boolean
  details: PreSyncDetail[]
}

interface PreSyncStatus {
  settings: PreSyncSettings
  timezone: string
  nextTargetDate: string
  nextTargetCount: number
  lastRunDate: string | null
  running: boolean
  runs: PreSyncRun[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export default function PreArrivalTab() {
  const [status, setStatus] = useState<PreSyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customDays, setCustomDays] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (quiet = false) => {
    try {
      const res = await fetch('/api/as-bookings-v2/prearrival')
      const json = await readApiResponse<PreSyncStatus>(res)
      if (json.success && json.data) { setStatus(json.data); setError(null) }
      else if (!quiet) setError(json.error ?? 'Could not load sync status')
    } catch {
      if (!quiet) setError('Network error loading sync status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // The job runs server-side, so keep the panel honest while it is open.
    pollRef.current = setInterval(() => { void load(true) }, 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load])

  const save = useCallback(async (patch: Partial<PreSyncSettings>) => {
    if (!status) return
    const next = { ...status.settings, ...patch }
    setSaving(true)
    setStatus({ ...status, settings: next })   // optimistic
    try {
      const res = await fetch('/api/as-bookings-v2/prearrival', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await readApiResponse<{ settings: PreSyncSettings }>(res)
      if (!json.success) toast.error(json.error ?? 'Could not save')
      await load(true)
    } catch {
      toast.error('Network error saving settings')
      await load(true)
    } finally {
      setSaving(false)
    }
  }, [status, load])

  const runNow = useCallback(async () => {
    setRunning(true)
    try {
      const res = await fetch('/api/as-bookings-v2/prearrival/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await readApiResponse<{ ran: boolean; run?: PreSyncRun; status: PreSyncStatus }>(res)
      if (!json.success) { toast.error(json.error ?? 'Run failed'); return }
      if (json.data?.status) setStatus(json.data.status)
      const run = json.data?.run
      if (run && run.failed > 0) toast.warning(json.message ?? 'Run finished with failures')
      else if (run && run.updated > 0) toast.success(json.message ?? 'Bookings updated')
      else toast.info(json.message ?? 'Nothing to update')
    } catch {
      toast.error('Network error during run')
    } finally {
      setRunning(false)
      void load(true)
    }
  }, [load])

  const s = status?.settings
  const enabled = !!s?.enabled

  const applyCustomDays = useCallback(() => {
    const n = parseInt(customDays, 10)
    if (!Number.isFinite(n) || n < MIN_DAYS || n > MAX_DAYS) {
      toast.error(`Enter a number between ${MIN_DAYS} and ${MAX_DAYS}`)
      return
    }
    setCustomDays('')
    void save({ daysBefore: n })
  }, [customDays, save])

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

      {/* ── Hero: switch + what the next run will do ─────────────────────── */}
      <Card className="overflow-hidden">
        <div className="relative p-5 sm:p-6">
          {enabled && (
            <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-brand-400/10 blur-3xl" />
          )}

          <div className="relative flex flex-col sm:flex-row sm:items-start justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                enabled ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/25' : 'bg-slate-100 text-slate-400'
              }`}>
                <CalendarClock className={`w-6 h-6 ${status?.running ? 'animate-pulse' : ''}`} />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900">Pre-arrival sync</h3>
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
                    {status?.running ? 'Running' : enabled ? 'On' : 'Paused'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 max-w-lg leading-relaxed">
                  Every day at{' '}
                  <span className="font-medium">{pad(s?.hour ?? 5)}:{pad(s?.minute ?? 30)}</span>{' '}
                  ({status?.timezone}), re-pulls every booking arriving in{' '}
                  <span className="font-medium">{s?.daysBefore} day{s?.daysBefore === 1 ? '' : 's'}</span>{' '}
                  from AppleSystem, so the last plan ops works from is the current one. Runs on the
                  server, with nobody logged in.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={runNow}
                disabled={running}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin text-brand-500' : 'text-slate-400'}`} />
                {running ? 'Syncing…' : 'Run now'}
              </button>

              <button
                role="switch"
                aria-checked={enabled}
                aria-label="Toggle pre-arrival sync"
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

          <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100">
            <Metric
              icon={<CalendarDays className="w-3.5 h-3.5" />}
              label="Next target arrivals"
              value={status?.nextTargetDate ?? '—'}
              hint={`T−${s?.daysBefore} from today (${status?.timezone})`}
            />
            <Metric
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              label="Bookings covered"
              value={String(status?.nextTargetCount ?? 0)}
              hint="Live bookings arriving on that date right now"
              tone={(status?.nextTargetCount ?? 0) > 0 ? 'good' : 'muted'}
            />
            <Metric
              icon={<Clock className="w-3.5 h-3.5" />}
              label="Last run"
              value={status?.runs[0] ? fmtDateTime(status.runs[0].at) : 'Never'}
              hint={status?.lastRunDate ? `Daily guard: ${status.lastRunDate}` : 'No run recorded yet'}
            />
            <Metric
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
              label="Failures last run"
              value={String(status?.runs[0]?.failed ?? 0)}
              hint={(status?.runs[0]?.failed ?? 0) > 0 ? 'Retried on the next run' : 'No failures recorded'}
              tone={(status?.runs[0]?.failed ?? 0) > 0 ? 'bad' : 'muted'}
            />
          </div>
        </div>
      </Card>

      {/* ── Tuning ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-900">How many days before arrival</h4>
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            A booking is refreshed once, this many days before the guests arrive. Three days is
            usually the sweet spot — late enough that the file has settled upstream, early enough to
            act on a change.
          </p>

          <div className="flex flex-wrap gap-2 mt-4">
            {DAY_PRESETS.map((d) => {
              const on = s?.daysBefore === d
              return (
                <button
                  key={d}
                  disabled={saving}
                  onClick={() => { setCustomDays(''); void save({ daysBefore: d }) }}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition-all disabled:opacity-50 ${
                    on ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-sm'
                       : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {d} day{d === 1 ? '' : 's'}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              min={MIN_DAYS}
              max={MAX_DAYS}
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyCustomDays() }}
              placeholder="Custom"
              className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <button
              disabled={saving || !customDays}
              onClick={applyCustomDays}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Set
            </button>
            <span className="text-xs text-slate-400">{MIN_DAYS}–{MAX_DAYS} days</span>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-900">What time it runs</h4>
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Early morning keeps the sweep clear of the working day, so ops opens a file that is
            already current. Times are {status?.timezone}.
          </p>

          <div className="mt-4 flex items-center gap-2">
            <select
              disabled={saving}
              value={s?.hour ?? 5}
              onChange={(e) => save({ hour: Number(e.target.value) })}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none disabled:opacity-50"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{pad(h)}</option>
              ))}
            </select>
            <span className="text-slate-400">:</span>
            <select
              disabled={saving}
              value={s?.minute ?? 30}
              onChange={(e) => save({ minute: Number(e.target.value) })}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none disabled:opacity-50"
            >
              {[0, 15, 30, 45].map((m) => (
                <option key={m} value={m}>{pad(m)}</option>
              ))}
            </select>
          </div>

          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5" /> What it never changes
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-emerald-900">
              Booking status, the operation checklist, tickets, driver allocation, agenda, P&amp;L and
              client confirmations are never written by a sync. Fields AppleSystem sends blank keep
              their current value, and cancelled or completed files are skipped entirely.
            </p>
          </div>
        </Card>
      </div>

      {/* ── Run history ──────────────────────────────────────────────────── */}
      <Card className="p-5">
        <h4 className="text-sm font-semibold text-slate-900">Recent runs</h4>
        {(!status?.runs || status.runs.length === 0) ? (
          <p className="mt-3 text-sm text-slate-400">No run has happened yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {status.runs.map((run) => (
              <RunRow key={`${run.at}-${run.targetDate}`} run={run} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Metric({
  icon, label, value, hint, tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'good' | 'bad' | 'muted'
}) {
  const valueTone =
    tone === 'good' ? 'text-emerald-700'
    : tone === 'bad' ? 'text-red-600'
    : tone === 'muted' ? 'text-slate-500'
    : 'text-slate-900'
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {icon} {label}
      </p>
      <p className={`mt-1 text-sm font-bold ${valueTone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400 leading-snug">{hint}</p>}
    </div>
  )
}

function RunRow({ run }: { run: PreSyncRun }) {
  const [open, setOpen] = useState(false)
  const tone = run.failed > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'

  return (
    <div className={`rounded-xl border ${tone}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-800">
            Arrivals {run.targetDate}{' '}
            <span className="font-normal text-slate-500">
              · T−{run.daysBefore} · {run.mode === 'auto' ? 'scheduled' : 'manual'}
            </span>
          </p>
          <p className="text-[11px] text-slate-500">
            {fmtDateTime(run.at)} · {Math.max(1, Math.round(run.durationMs / 1000))}s
            {run.capped && <span className="ml-1 text-amber-700">· capped</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px] font-semibold">
          <span className="text-emerald-700">{run.updated} updated</span>
          <span className="text-slate-500">{run.unchanged} current</span>
          <span className={run.failed > 0 ? 'text-red-600' : 'text-slate-400'}>{run.failed} failed</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3.5 py-2.5">
          {run.details.length === 0 ? (
            <p className="text-[11px] text-slate-400">No bookings arrived on this date.</p>
          ) : (
            <ul className="space-y-1">
              {run.details.map((d) => (
                <li key={d.bookingRef} className="flex items-start gap-2 text-[11px]">
                  {d.status === 'failed'
                    ? <XCircle className="mt-0.5 w-3 h-3 shrink-0 text-red-500" />
                    : <CheckCircle2 className={`mt-0.5 w-3 h-3 shrink-0 ${d.status === 'updated' ? 'text-emerald-500' : 'text-slate-300'}`} />}
                  <span className="font-mono font-semibold text-slate-700">{d.bookingRef}</span>
                  <span className="text-slate-500">
                    {d.status === 'failed'
                      ? d.error
                      : d.status === 'unchanged'
                        ? 'already current'
                        : (d.changed?.length ? d.changed.join(', ') : 'updated')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
