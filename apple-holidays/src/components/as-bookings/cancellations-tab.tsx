'use client'

/**
 * **Cancellations** tab — everything about AppleSystem cancellations in one place.
 *
 *   1. Flow hero      — how a status-3 quotation travels to "Requested to cancel",
 *                       with live counts on every step and the next daily run.
 *   2. Health         — warns when the daily check has stopped running (on
 *                       Amplify that means the external cron hit is missing).
 *   3. Work queue     — every cancellation we hold, filtered by who has to act:
 *                       a person, accounts, or nobody. Per-row mini timeline.
 *   4. Run pulse      — the last checks as a bar strip (found vs requested).
 *   5. Check controls — the daily settings + range check (`CancelSweepCard`).
 *
 * Reads two existing endpoints, writes only through them. No new tables.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Ban, Radar, UserCheck, ShieldCheck, Send, Scale, ChevronRight, Loader2, Search,
  AlertTriangle, CheckCircle2, ExternalLink, Trash2, MailCheck, Lock, Ticket,
  LayoutDashboard, Zap, Clock, Activity, RefreshCw,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { fmtDateTime } from './shared'
import CancelSweepCard from './cancel-sweep-card'
import { CANCEL_STATE_META, relTime, type CancelEntry, type CancelState, type WatchStatus } from './watch-shared'

// ── Shapes (mirror /api/as-bookings-v2/cancel-sweep) ──────────────────────────

interface DailyConfig { enabled: boolean; hour: number; lookbackDays: number; autoRequest: boolean }
interface DailyStatus { config: DailyConfig; lastRunDate: string | null; nextWindow: { from: string; to: string }; due: boolean }
interface RunSummary { upstream: number; matched: number; requested: number; awaiting: number; skipped: number; failed: number; superseded?: number }
interface Run {
  at: string; trigger: 'daily' | 'cron' | 'manual'; mode: 'request' | 'detect'
  dateField: 'create' | 'arrival'; from: string; to: string; by: string
  durationMs: number; summary: RunSummary; error?: string
}
interface SweepSnapshot { daily: DailyStatus; runs: Run[]; maxRangeDays: number; canConfigure: boolean }

type Lane = 'you' | 'accounts' | 'done' | 'all'

const LANES: { key: Lane; label: string; states: CancelState[]; tone: string }[] = [
  { key: 'you',      label: 'Needs a person',  states: ['awaiting', 'failed'],             tone: 'bg-rose-500' },
  { key: 'accounts', label: 'With accounts',   states: ['requested'],                      tone: 'bg-orange-500' },
  { key: 'done',     label: 'Decided',         states: ['approved', 'declined', 'skipped'], tone: 'bg-slate-400' },
  { key: 'all',      label: 'All',             states: ['awaiting', 'failed', 'requested', 'approved', 'declined', 'skipped'], tone: 'bg-slate-800' },
]

const STATE_STYLE: Record<CancelState, { bar: string; chip: string; dot: string }> = {
  awaiting:  { bar: 'bg-rose-500',    chip: 'bg-rose-50 text-rose-700 ring-rose-200',       dot: 'bg-rose-500' },
  failed:    { bar: 'bg-rose-600',    chip: 'bg-rose-50 text-rose-700 ring-rose-200',       dot: 'bg-rose-600' },
  requested: { bar: 'bg-orange-500',  chip: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500' },
  approved:  { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  declined:  { bar: 'bg-violet-500',  chip: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  skipped:   { bar: 'bg-slate-300',   chip: 'bg-slate-50 text-slate-600 ring-slate-200',    dot: 'bg-slate-400' },
}

// ── Time helpers (Colombo — the daily check runs on Colombo time) ─────────────

const TZ = 'Asia/Colombo'

function colomboYmd(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Next instant the daily check becomes due, as epoch ms (Colombo is UTC+5:30, no DST). */
function nextDailyAt(cfg: DailyConfig, lastRunDate: string | null, now: number): number {
  const today = colomboYmd(new Date(now))
  const at = (ymd: string) => Date.parse(`${ymd}T${String(cfg.hour).padStart(2, '0')}:00:00+05:30`)
  const todayAt = at(today)
  if (lastRunDate !== today && now < todayAt) return todayAt
  if (lastRunDate !== today) return now          // due now — waiting for the next tick / cron hit
  const t = new Date(`${today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1)
  return at(t.toISOString().slice(0, 10))
}

function useTicker(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id) }, [ms])
  return now
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CancellationsTab() {
  const [watch, setWatch] = useState<WatchStatus | null>(null)
  const [sweep, setSweep] = useState<SweepSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lane, setLane] = useState<Lane>('you')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [runningToday, setRunningToday] = useState(false)
  const now = useTicker()

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true)
    try {
      const [w, s] = await Promise.all([
        fetch('/api/as-bookings-v2/watch').then((r) => readApiResponse<WatchStatus>(r)).catch(() => null),
        fetch('/api/as-bookings-v2/cancel-sweep').then((r) => readApiResponse<SweepSnapshot>(r)).catch(() => null),
      ])
      if (w?.success && w.data) setWatch(w.data)
      if (s?.success && s.data) setSweep(s.data)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
    const id = setInterval(() => { void load(true) }, 30_000)
    return () => clearInterval(id)
  }, [load])

  const entries = useMemo(() => watch?.cancellations?.entries ?? [], [watch])
  const count = (states: CancelState[]) => entries.filter((e) => states.includes(e.state)).length
  const lastRun = sweep?.runs?.[0] ?? null
  const lastAuto = sweep?.runs?.find((r) => r.trigger !== 'manual') ?? null
  const cfg = sweep?.daily.config

  // Health: switched on, past today's hour, and the last daily stamp is older than yesterday.
  const health = useMemo(() => {
    if (!sweep || !cfg?.enabled) return null
    const today = colomboYmd(new Date(now))
    const y = new Date(`${today}T00:00:00Z`); y.setUTCDate(y.getUTCDate() - 1)
    const yesterday = y.toISOString().slice(0, 10)
    const last = sweep.daily.lastRunDate
    if (!last || last < yesterday) return { stale: true, last }
    if (lastAuto?.error) return { stale: false, last, error: lastAuto.error }
    return null
  }, [sweep, cfg, now, lastAuto])

  const nextAt = cfg && sweep ? nextDailyAt(cfg, sweep.daily.lastRunDate, now) : null

  const shown = useMemo(() => {
    const states = LANES.find((l) => l.key === lane)!.states
    const q = query.trim().toLowerCase()
    return entries
      .filter((e) => states.includes(e.state))
      .filter((e) => !q || [e.ref, e.guestName, e.quotationNo, e.country].some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
  }, [entries, lane, query])

  const sendOne = async (ref: string) => {
    setBusy(ref)
    try {
      const res = await fetch('/api/as-bookings-v2/watch/cancellations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref }),
      })
      const json = await readApiResponse<{ status: WatchStatus }>(res)
      if (!json.success) { toast.error(json.error ?? 'Could not send for approval'); return }
      if (json.data?.status) setWatch(json.data.status)
      toast.success(json.message ?? `${ref} requested to cancel`)
    } catch {
      toast.error('Network error sending the request')
    } finally { setBusy(null) }
  }

  const clearOne = async (ref: string) => {
    setBusy(ref)
    try {
      const res = await fetch(`/api/as-bookings-v2/watch/cancellations?ref=${encodeURIComponent(ref)}`, { method: 'DELETE' })
      const json = await readApiResponse<{ status: WatchStatus }>(res)
      if (!json.success) { toast.error(json.error ?? 'Could not clear'); return }
      if (json.data?.status) setWatch(json.data.status)
    } catch {
      toast.error('Network error clearing the row')
    } finally { setBusy(null) }
  }

  /** Run the daily window right now, with the daily setting's mode. */
  const runTodayNow = async () => {
    if (!sweep || !cfg) return
    const mode = cfg.autoRequest ? 'request' : 'detect'
    const { from, to } = sweep.daily.nextWindow
    if (mode === 'request' && !window.confirm(
      `Check AppleSystem for quotations created ${from} → ${to} that are now cancelled, ` +
      'and move each matching booking to "Requested to cancel"?\n\nNothing is cancelled — accounts decide.',
    )) return
    setRunningToday(true)
    try {
      const res = await fetch('/api/as-bookings-v2/cancel-sweep', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, dateField: 'create', mode }),
      })
      const json = await readApiResponse<SweepSnapshot & { run: Run }>(res)
      if (!json.success || !json.data) { toast.error(json.error ?? 'The check failed'); return }
      toast.success(json.message ?? 'Check complete')
      await load(true)
    } catch {
      toast.error('Network error — the check may still be running')
    } finally { setRunningToday(false) }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
      </div>
    )
  }

  // Flow step counts — latest run for the upstream side, ledger for our side.
  const s = lastRun?.summary
  const steps = [
    { icon: Ban,         title: 'Cancelled in AppleSystem', sub: 'quotation status 3',          value: s?.upstream ?? 0, foot: lastRun ? 'last check' : 'no check yet' },
    { icon: Radar,       title: 'Booking found here',       sub: 'matched by IS number',        value: s?.matched ?? 0,  foot: 'from AppleSystem only' },
    { icon: ShieldCheck, title: 'Double-checked',           sub: 'amendments are kept',         value: Math.max(0, (s?.matched ?? 0) - (s?.superseded ?? 0)), foot: `${s?.superseded ?? 0} amended · kept` },
    { icon: Send,        title: 'Requested to cancel',      sub: 'MC report · Ops Board',       value: count(['requested']), foot: 'waiting on accounts', hot: true },
    { icon: Scale,       title: 'Accounts decide',          sub: 'approve or decline',          value: count(['approved', 'declined']), foot: `${count(['approved'])} approved · ${count(['declined'])} declined` },
  ]

  return (
    <div className="space-y-5">
      {/* ── 1. Flow hero ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-rose-950 p-5 sm:p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-rose-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-48 w-48 rounded-full bg-orange-500/10 blur-3xl" />

        <div className="relative flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-300">
              <span className="relative flex h-2 w-2">
                {cfg?.enabled && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg?.enabled ? 'bg-rose-400' : 'bg-slate-500'}`} />
              </span>
              AppleSystem cancellation watch
            </div>
            <h2 className="mt-2 text-xl sm:text-2xl font-bold tracking-tight">
              Cancelled upstream → requested here, automatically
            </h2>
            <p className="mt-1.5 text-sm text-slate-300 max-w-2xl leading-relaxed">
              Every day the system asks AppleSystem which quotations created in the last{' '}
              <strong className="text-white">{cfg?.lookbackDays ?? 2} days</strong> are now cancelled (status 3),
              checks each one twice, and moves the booking to <strong className="text-orange-300">Requested to cancel</strong>.
              Nothing is ever cancelled outright — accounts decide.
            </p>
          </div>

          {/* Next-run dial */}
          <div className="shrink-0 flex items-center gap-4 rounded-2xl bg-white/5 ring-1 ring-white/10 px-4 py-3 backdrop-blur">
            <NextRunDial cfg={cfg} nextAt={nextAt} now={now} />
            <div className="text-xs space-y-1">
              <p className="text-slate-400">Daily check</p>
              <p className="font-semibold text-white">
                {!cfg?.enabled ? 'Switched off'
                  : nextAt && nextAt <= now ? 'Due now'
                    : nextAt ? `in ${relTime(nextAt - now)}` : '—'}
              </p>
              <p className="text-slate-400 tabular-nums">
                {cfg ? `${String(cfg.hour).padStart(2, '0')}:00 Colombo · ${cfg.autoRequest ? 'auto-request' : 'list only'}` : ''}
              </p>
              <button type="button" onClick={() => void runTodayNow()} disabled={runningToday || !cfg}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-orange-400 disabled:opacity-50">
                {runningToday ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Run today&apos;s check now
              </button>
            </div>
          </div>
        </div>

        {/* Flow */}
        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-0">
          {steps.map((st, i) => {
            const Icon = st.icon
            return (
              <div key={st.title} className="relative flex sm:flex-col items-center sm:items-stretch gap-3 sm:gap-0">
                <div className={`relative z-10 flex-1 rounded-xl px-3.5 py-3 ring-1 transition-colors sm:mx-1.5 ${
                  st.hot && st.value > 0 ? 'bg-orange-500/15 ring-orange-400/40' : 'bg-white/[0.04] ring-white/10'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                      st.hot ? 'bg-orange-500/20 text-orange-300' : 'bg-white/10 text-slate-200'
                    }`}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="text-2xl font-bold tabular-nums">{st.value}</span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-white leading-tight">{st.title}</p>
                  <p className="text-[11px] text-slate-400">{st.sub}</p>
                  <p className="mt-1.5 text-[10px] text-slate-500">{st.foot}</p>
                </div>
                {i < steps.length - 1 && (
                  <ChevronRight className="hidden sm:block absolute -right-2 top-1/2 z-20 -translate-y-1/2 w-4 h-4 text-slate-500" />
                )}
              </div>
            )
          })}
        </div>

        {/* What "requested" means across the system */}
        <div className="relative mt-4 flex flex-wrap gap-2 text-[11px]">
          <Effect icon={LayoutDashboard} text="MC Report & Ops Board show “Requested to cancel”" />
          <Effect icon={Lock} text="New drivers & vendors cannot be assigned" />
          <Effect icon={Ticket} text="Tickets can still be issued" ok />
          <Effect icon={UserCheck} text="On-tour bookings wait for a person" />
        </div>
      </div>

      {/* ── 2. Health ─────────────────────────────────────────────────────── */}
      {health?.stale && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-600" />
          <div>
            <p className="font-semibold">
              The daily check hasn&apos;t run {health.last ? `since ${health.last}` : 'yet'}.
            </p>
            <p className="mt-0.5 text-amber-800">
              On the live site it needs something outside the app to call <code className="rounded bg-amber-100 px-1">/api/cron/as-cancel-sweep</code> every
              hour (with the cron secret). Until then, use <strong>Run today&apos;s check now</strong> above or a range check below.
            </p>
          </div>
        </div>
      )}
      {health?.error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-rose-600" />
          <p><strong>Last daily check could not read AppleSystem:</strong> {health.error}. It retries on the next tick.</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* ── 3. Work queue ───────────────────────────────────────────────── */}
        <Card className="xl:col-span-2 p-0 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Cancellation queue</h3>
              <p className="text-[11px] text-slate-500">Every AppleSystem cancellation we hold a booking for, by who has to act next.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ref, guest, quotation…"
                  className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
              <button type="button" onClick={() => void load()} title="Refresh"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Lanes */}
          <div className="flex gap-1 overflow-x-auto px-5 pt-3">
            {LANES.map((l) => {
              const n = count(l.states)
              const active = lane === l.key
              return (
                <button key={l.key} type="button" onClick={() => setLane(l.key)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                    active ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${l.tone}`} />
                  {l.label}
                  <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${active ? 'bg-white/20' : 'bg-white text-slate-500'}`}>{n}</span>
                </button>
              )
            })}
          </div>

          {/* Stacked share bar */}
          {entries.length > 0 && (
            <div className="mx-5 mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
              {(['awaiting', 'failed', 'requested', 'approved', 'declined', 'skipped'] as CancelState[]).map((st) => {
                const n = count([st])
                return n ? <div key={st} className={STATE_STYLE[st].bar} style={{ width: `${(n / entries.length) * 100}%` }} title={`${CANCEL_STATE_META[st].label}: ${n}`} /> : null
              })}
            </div>
          )}

          <ul className="max-h-[34rem] overflow-y-auto divide-y divide-slate-100 mt-2">
            {shown.length === 0 ? (
              <li className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                <p className="text-sm font-medium text-slate-700">
                  {lane === 'you' ? 'Nothing needs you right now' : lane === 'accounts' ? 'Nothing waiting on accounts' : 'Nothing here'}
                </p>
                <p className="text-xs text-slate-400">
                  {query ? 'No match for that search.' : 'New AppleSystem cancellations land here after each check.'}
                </p>
              </li>
            ) : shown.map((e) => (
              <QueueRow key={e.ref} e={e} now={now} busy={busy === e.ref}
                onSend={() => void sendOne(e.ref)} onClear={() => void clearOne(e.ref)} />
            ))}
          </ul>
        </Card>

        {/* ── 4. Run pulse ────────────────────────────────────────────────── */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-semibold text-slate-900">Check pulse</h3>
          </div>
          <RunPulse runs={sweep?.runs ?? []} />
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Needs a person" value={count(['awaiting', 'failed'])} tone="rose" />
            <Stat label="With accounts" value={count(['requested'])} tone="orange" />
            <Stat label="Approved" value={count(['approved'])} tone="emerald" />
            <Stat label="Declined" value={count(['declined'])} tone="violet" />
          </div>
          {lastRun && (
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600 space-y-0.5">
              <p className="flex items-center gap-1.5 font-semibold text-slate-700">
                <Clock className="w-3 h-3" /> Last check · {relTime(now - Date.parse(lastRun.at))} ago
              </p>
              <p>
                {lastRun.trigger === 'manual' ? `${lastRun.mode === 'detect' ? 'Preview' : 'Range check'} by ${lastRun.by}` : 'Daily automatic'}
                {' · '}{lastRun.dateField === 'arrival' ? 'arriving' : 'created'} {lastRun.from} → {lastRun.to}
              </p>
              <p className="tabular-nums">
                {lastRun.error ? <span className="text-rose-700">failed: {lastRun.error}</span>
                  : `${lastRun.summary.upstream} found · ${lastRun.summary.matched} ours · ${lastRun.summary.requested} requested`}
              </p>
            </div>
          )}
          <Link href="/dashboard/accounts/cancellations"
            className="flex items-center justify-between rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs font-semibold text-orange-800 hover:bg-orange-100">
            <span className="flex items-center gap-2"><MailCheck className="w-4 h-4" /> Open the accounts approval queue</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </Card>
      </div>

      {/* ── 5. Daily settings + range check + history ─────────────────────── */}
      <CancelSweepCard onRan={() => { void load(true) }} />
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Effect({ icon: Icon, text, ok }: { icon: typeof Lock; text: string; ok?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ${
      ok ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30' : 'bg-white/5 text-slate-300 ring-white/10'
    }`}>
      <Icon className="w-3 h-3" /> {text}
    </span>
  )
}

/** A 24-hour ring: how much of the day is left until the next daily check. */
function NextRunDial({ cfg, nextAt, now }: { cfg?: DailyConfig; nextAt: number | null; now: number }) {
  const R = 26
  const C = 2 * Math.PI * R
  const left = nextAt ? Math.max(0, nextAt - now) : 0
  const frac = cfg?.enabled && nextAt ? 1 - Math.min(1, left / 86_400_000) : 0
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0">
      <circle cx="34" cy="34" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
      <circle cx="34" cy="34" r={R} fill="none" stroke={cfg?.enabled ? '#fb923c' : '#64748b'} strokeWidth="6"
        strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
        transform="rotate(-90 34 34)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      <text x="34" y="38" textAnchor="middle" className="fill-white" fontSize="12" fontWeight="700">
        {cfg ? `${String(cfg.hour).padStart(2, '0')}:00` : '—'}
      </text>
    </svg>
  )
}

function QueueRow({ e, now, busy, onSend, onClear }: {
  e: CancelEntry; now: number; busy: boolean; onSend: () => void; onClear: () => void
}) {
  const meta = CANCEL_STATE_META[e.state]
  const style = STATE_STYLE[e.state]
  const canSend = e.state === 'awaiting' || e.state === 'failed'
  const settled = e.state === 'approved' || e.state === 'declined' || e.state === 'skipped'
  const byApple = !e.actedBy || /applesystem|automatic|daily/i.test(e.actedBy)

  // Three-step mini timeline: detected → requested → decided.
  const marks = [
    { label: 'Found', at: e.detectedAt, on: true },
    { label: 'Requested', at: e.requestedAt, on: !!e.requestedAt || ['requested', 'approved', 'declined'].includes(e.state) },
    { label: e.state === 'declined' ? 'Declined' : 'Approved', at: e.decidedAt, on: e.state === 'approved' || e.state === 'declined' },
  ]

  return (
    <li className="group relative px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
      <span className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${style.bar}`} />
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/bookings/${encodeURIComponent(e.ref)}`}
              className="inline-flex items-center gap-1 text-sm font-bold text-slate-900 hover:text-brand-700 tabular-nums">
              {e.ref}<ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </Link>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${style.chip}`}>{meta.label}</span>
            {e.state === 'requested' && byApple && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200">AppleSystem</span>
            )}
            {e.country && <span className="text-[10px] font-semibold text-slate-400">{e.country}</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500 truncate">
            {e.guestName ?? 'Guest unknown'}
            {e.arrivalDate ? ` · arrives ${e.arrivalDate}` : ''}
            {` · Q ${e.quotationNo || '—'}`}
            {e.prevStatus ? ` · was ${e.prevStatus.replace(/_/g, ' ').toLowerCase()}` : ''}
          </p>
          {(e.note || canSend) && (
            <p className="mt-0.5 text-[11px] text-slate-400 line-clamp-2">{e.note ?? meta.blurb}</p>
          )}
        </div>

        {/* Mini timeline */}
        <div className="flex items-center gap-1 shrink-0">
          {marks.map((m, i) => (
            <div key={m.label} className="flex items-center gap-1">
              <div className="flex flex-col items-center w-16" title={m.at ? fmtDateTime(m.at) : ''}>
                <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-white ${m.on ? style.dot : 'bg-slate-200'}`} />
                <span className={`mt-1 text-[9px] font-semibold uppercase tracking-wide ${m.on ? 'text-slate-600' : 'text-slate-300'}`}>{m.label}</span>
                <span className="text-[9px] text-slate-400 tabular-nums h-3">{m.at ? `${relTime(now - Date.parse(m.at))} ago` : ''}</span>
              </div>
              {i < marks.length - 1 && <span className={`h-px w-4 -mt-6 ${marks[i + 1].on ? style.bar : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 md:w-36 md:justify-end">
          {canSend && (
            <button type="button" onClick={onSend} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Request cancel
            </button>
          )}
          {e.state === 'requested' && (
            <Link href="/dashboard/accounts/cancellations"
              className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-50">
              <MailCheck className="w-3 h-3" /> Accounts
            </Link>
          )}
          {settled && (
            <button type="button" onClick={onClear} disabled={busy} title="Remove from this list — the booking is not touched"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50">
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** Last checks as bars: grey = cancelled upstream, orange = requested here. */
function RunPulse({ runs }: { runs: Run[] }) {
  const list = runs.slice(0, 12).reverse()
  if (!list.length) return <p className="text-xs text-slate-400">No checks have run yet.</p>
  const max = Math.max(1, ...list.map((r) => r.summary.upstream))
  return (
    <div>
      <div className="flex items-end gap-1.5 h-24">
        {list.map((r) => {
          const h = (r.summary.upstream / max) * 100
          const req = r.summary.upstream ? (r.summary.requested / r.summary.upstream) * 100 : 0
          return (
            <div key={r.at} className="group relative flex-1 h-full flex items-end"
              title={`${fmtDateTime(r.at)} · ${r.trigger === 'manual' ? 'manual' : 'daily'}\n${r.error ? `failed: ${r.error}` : `${r.summary.upstream} found · ${r.summary.requested} requested`}`}>
              {r.error ? (
                <div className="w-full h-2 rounded bg-rose-400" />
              ) : (
                <div className={`w-full rounded-t-md overflow-hidden flex flex-col justify-end ${r.summary.upstream ? 'bg-slate-200' : 'bg-slate-100'}`}
                  style={{ height: `${Math.max(6, h)}%` }}>
                  <div className="w-full bg-gradient-to-t from-orange-500 to-orange-400" style={{ height: `${req}%` }} />
                </div>
              )}
              {r.trigger !== 'manual' && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-rose-400" />}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-200" /> found</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-orange-500" /> requested</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> daily run</span>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'rose' | 'orange' | 'emerald' | 'violet' }) {
  const c = { rose: 'text-rose-700', orange: 'text-orange-700', emerald: 'text-emerald-700', violet: 'text-violet-700' }[tone]
  return (
    <div className="rounded-xl border border-slate-100 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${value ? c : 'text-slate-300'}`}>{value}</p>
    </div>
  )
}
