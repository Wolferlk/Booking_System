'use client'

/**
 * Daily AppleSystem cancellation check + "check any date range" tool.
 *
 * Sits above the "Cancelled in AppleSystem" panel on the Live Watch tab. The
 * panel shows the running ledger; this card is where the daily job is
 * configured, and where a person can sweep an arbitrary window — previewing
 * first, then requesting for real — and read a per-booking report of exactly
 * what happened to each cancelled quotation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock, CalendarRange, Eye, Loader2, Send, ShieldCheck, History,
  ExternalLink, Info, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { fmtDateTime } from './shared'

// ── Shapes (mirror src/lib/as-cancel-sweep.ts + as-watch-cancel.ts) ──────────

interface DailyConfig { enabled: boolean; hour: number; lookbackDays: number; autoRequest: boolean }
interface DailyStatus { config: DailyConfig; lastRunDate: string | null; nextWindow: { from: string; to: string }; due: boolean }

type Outcome =
  | 'requested' | 'already-requested' | 'awaiting' | 'on-ground' | 'superseded'
  | 'closed-here' | 'not-imported' | 'not-in-system' | 'no-is-number'
  | 'decided' | 'unverified' | 'failed'

interface Detail {
  ref: string | null; quotationNo: string; createdOn: string | null; arrivalDate: string | null
  outcome: Outcome; note: string | null
}

interface Summary {
  upstream: number; matched: number; requested: number; awaiting: number
  skipped: number; failed: number; refs: string[]; superseded?: number; details?: Detail[]
}

interface Run {
  at: string; trigger: 'daily' | 'cron' | 'manual'; mode: 'request' | 'detect'
  dateField: 'create' | 'arrival'; from: string; to: string; by: string
  durationMs: number; summary: Summary; error?: string
}

interface Snapshot { daily: DailyStatus; runs: Run[]; maxRangeDays: number; canConfigure: boolean }

const OUTCOME_META: Record<Outcome, { label: string; chip: string; rank: number }> = {
  'requested':         { label: 'Requested to cancel', chip: 'bg-orange-100 text-orange-800 border-orange-200', rank: 0 },
  'on-ground':         { label: 'On tour — needs a person', chip: 'bg-rose-100 text-rose-800 border-rose-200', rank: 1 },
  'awaiting':          { label: 'Found — not sent', chip: 'bg-amber-100 text-amber-800 border-amber-200', rank: 2 },
  'unverified':        { label: 'Could not verify', chip: 'bg-amber-100 text-amber-800 border-amber-200', rank: 3 },
  'failed':            { label: 'Failed', chip: 'bg-rose-100 text-rose-800 border-rose-200', rank: 4 },
  'superseded':        { label: 'Amended — still confirmed', chip: 'bg-sky-100 text-sky-800 border-sky-200', rank: 5 },
  'already-requested': { label: 'Already requested', chip: 'bg-orange-50 text-orange-700 border-orange-200', rank: 6 },
  'decided':           { label: 'Accounts decided', chip: 'bg-slate-100 text-slate-700 border-slate-200', rank: 7 },
  'closed-here':       { label: 'Already closed here', chip: 'bg-slate-100 text-slate-600 border-slate-200', rank: 8 },
  'not-imported':      { label: 'Not from AppleSystem', chip: 'bg-slate-100 text-slate-600 border-slate-200', rank: 9 },
  'not-in-system':     { label: 'Not in our system', chip: 'bg-white text-slate-400 border-slate-200', rank: 10 },
  'no-is-number':      { label: 'No IS number', chip: 'bg-white text-slate-400 border-slate-200', rank: 11 },
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const DAYS_BACK = [1, 2, 3, 5, 7, 14]

// ── Date helpers (local calendar days — the page user is in Colombo/Hanoi) ───

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function addDays(base: Date, n: number): Date {
  const d = new Date(base); d.setDate(d.getDate() + n); return d
}
function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CancelSweepCard({ onRan }: { onRan?: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [saving, setSaving] = useState(false)

  const today = useMemo(() => new Date(), [])
  const [dateField, setDateField] = useState<'create' | 'arrival'>('create')
  const [from, setFrom] = useState(ymd(addDays(today, -1)))
  const [to, setTo] = useState(ymd(today))
  const [running, setRunning] = useState<null | 'detect' | 'request'>(null)
  const [result, setResult] = useState<{ run: Run; details: Detail[] } | null>(null)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/as-bookings-v2/cancel-sweep')
      const json = await readApiResponse<Snapshot>(res)
      if (json.success && json.data) setSnap(json.data)
    } catch { /* the card stays in its loading state; the page has other errors to show */ }
  }, [])

  useEffect(() => { void load() }, [load])

  const saveConfig = useCallback(async (patch: Partial<DailyConfig>) => {
    if (!snap) return
    setSaving(true)
    setSnap({ ...snap, daily: { ...snap.daily, config: { ...snap.daily.config, ...patch } } })
    try {
      const res = await fetch('/api/as-bookings-v2/cancel-sweep', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await readApiResponse<Snapshot>(res)
      if (!json.success) toast.error(json.error ?? 'Could not save')
      else if (json.data) { setSnap(json.data); toast.success('Daily cancellation check saved') }
    } catch {
      toast.error('Network error saving the daily check')
    } finally {
      setSaving(false)
      void load()
    }
  }, [snap, load])

  const run = useCallback(async (mode: 'detect' | 'request') => {
    if (mode === 'request') {
      const ok = window.confirm(
        `Find every quotation AppleSystem has cancelled (${dateField === 'arrival' ? 'arriving' : 'created'} ` +
        `${from} → ${to}) and move each matching booking to "Requested to cancel"?\n\n` +
        'Nothing is cancelled — accounts approve or reject each one. Tours already on the ground, ' +
        'and quotations replaced by a confirmed one, are left alone.',
      )
      if (!ok) return
    }
    setRunning(mode)
    try {
      const res = await fetch('/api/as-bookings-v2/cancel-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, dateField, mode }),
      })
      const json = await readApiResponse<Snapshot & { run: Run; details: Detail[] }>(res)
      if (!json.success || !json.data) { toast.error(json.error ?? 'The check failed'); return }
      setResult({ run: json.data.run, details: json.data.details })
      setSnap({ daily: json.data.daily, runs: json.data.runs, maxRangeDays: json.data.maxRangeDays, canConfigure: json.data.canConfigure })
      setShowAll(false)
      if (mode === 'request' && json.data.run.summary.requested > 0) toast.warning(json.message ?? 'Requested')
      else toast.success(json.message ?? 'Check complete')
      onRan?.()
    } catch {
      toast.error('Network error — the check may still be running; reload in a minute')
    } finally {
      setRunning(null)
    }
  }, [from, to, dateField, onRan])

  const preset = (kind: 'last2' | 'last7' | 'last30' | 'next30') => {
    const t = new Date()
    if (kind === 'next30') { setDateField('arrival'); setFrom(ymd(t)); setTo(ymd(addDays(t, 30))); return }
    setDateField('create')
    setFrom(ymd(addDays(t, kind === 'last2' ? -1 : kind === 'last7' ? -6 : -29)))
    setTo(ymd(t))
  }

  const cfg = snap?.daily.config
  const canConfigure = !!snap?.canConfigure

  return (
    <Card className="p-5 space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-orange-500" />
            <h4 className="text-sm font-semibold text-slate-900">Daily AppleSystem cancellation check</h4>
            {cfg && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                cfg.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {cfg.enabled ? 'On' : 'Off'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed max-w-2xl">
            Once a day it lists every quotation <span className="font-medium">created in the last{' '}
            {cfg?.lookbackDays ?? 2} days</span> that AppleSystem now shows as cancelled (status 3).
            Each booking we hold for one is double-checked with AppleSystem, then moved to{' '}
            <span className="font-medium text-orange-700">Requested to cancel</span> for accounts to approve.
            It shows on the MC Report and Ops Board, drivers and vendors are locked, and tickets can still be issued.
          </p>
        </div>

        {snap && (
          <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-[11px] text-slate-600 space-y-0.5 min-w-[15rem]">
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Last daily run</span>
              <span className="font-medium tabular-nums">{snap.daily.lastRunDate || 'never'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Next window</span>
              <span className="font-medium tabular-nums">{snap.daily.nextWindow.from} → {snap.daily.nextWindow.to}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Status</span>
              <span className={`font-semibold ${snap.daily.due ? 'text-orange-700' : 'text-slate-600'}`}>
                {!cfg?.enabled ? 'switched off' : snap.daily.due ? 'due — runs within 20 min' : `next at ${hourLabel(cfg.hour)}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Daily settings ──────────────────────────────────────────────────── */}
      {cfg && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Setting label="Daily check">
            <Toggle on={cfg.enabled} disabled={!canConfigure || saving} onChange={(v) => void saveConfig({ enabled: v })}
              aria="Run the daily cancellation check" />
          </Setting>
          <Setting label="Runs from">
            <select value={cfg.hour} disabled={!canConfigure || saving}
              onChange={(e) => void saveConfig({ hour: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:opacity-60">
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)} (Colombo)</option>)}
            </select>
          </Setting>
          <Setting label="Look back">
            <select value={cfg.lookbackDays} disabled={!canConfigure || saving}
              onChange={(e) => void saveConfig({ lookbackDays: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:opacity-60">
              {DAYS_BACK.map((d) => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'} created</option>)}
            </select>
          </Setting>
          <Setting label="When found">
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-semibold">
              {([true, false] as const).map((v) => (
                <button key={String(v)} type="button" disabled={!canConfigure || saving}
                  onClick={() => cfg.autoRequest !== v && void saveConfig({ autoRequest: v })}
                  className={`flex-1 rounded-md px-2 py-1 transition-colors disabled:opacity-60 ${
                    cfg.autoRequest === v ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                  }`}>
                  {v ? 'Request' : 'List only'}
                </button>
              ))}
            </div>
          </Setting>
        </div>
      )}
      {snap && !canConfigure && (
        <p className="text-[11px] text-slate-400 flex items-center gap-1">
          <Info className="w-3 h-3" /> Only an admin can change the daily settings. Anyone on the desk can run a range check below.
        </p>
      )}

      {/* ── Range check ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-slate-400" />
          <h5 className="text-xs font-semibold text-slate-800">Check a date range now</h5>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">By</p>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-semibold">
              {(['create', 'arrival'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setDateField(f)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    dateField === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
                  }`}>
                  {f === 'create' ? 'Created date' : 'Arrival date'}
                </button>
              ))}
            </div>
          </div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700" />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['last2', 'Last 2 days'], ['last7', 'Last 7 days'], ['last30', 'Last 30 days'], ['next30', 'Arriving next 30 days'],
            ] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => preset(k)}
                className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50">
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void run('detect')} disabled={!!running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {running === 'detect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            Preview (changes nothing)
          </button>
          <button type="button" onClick={() => void run('request')} disabled={!!running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
            {running === 'request' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Find &amp; request to cancel
          </button>
          <span className="text-[11px] text-slate-400">
            Up to {snap?.maxRangeDays ?? 92} days at a time. A wide range can take a minute.
          </span>
        </div>

        {result && <RunReport run={result.run} details={result.details} showAll={showAll} onToggleAll={() => setShowAll((v) => !v)} />}
      </div>

      {/* ── History ─────────────────────────────────────────────────────────── */}
      {snap && snap.runs.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <History className="w-4 h-4 text-slate-400" />
            <h5 className="text-xs font-semibold text-slate-800">Recent checks</h5>
          </div>
          <ul className="space-y-1">
            {snap.runs.map((r) => (
              <li key={r.at}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-slate-100 px-3 py-1.5 text-[11px] text-slate-600">
                <span className="tabular-nums text-slate-400">{fmtDateTime(r.at)}</span>
                <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase ${
                  r.trigger === 'manual' ? 'bg-slate-100 text-slate-600' : 'bg-orange-50 text-orange-700'
                }`}>
                  {r.trigger === 'manual' ? (r.mode === 'detect' ? 'Preview' : 'Manual') : 'Daily'}
                </span>
                <span className="tabular-nums">{r.dateField === 'arrival' ? 'arriving' : 'created'} {r.from} → {r.to}</span>
                {r.error ? (
                  <span className="text-rose-700 font-medium truncate max-w-md" title={r.error}>failed: {r.error}</span>
                ) : (
                  <span>
                    {r.summary.upstream} cancelled upstream · {r.summary.matched} ours ·{' '}
                    <strong className={r.summary.requested ? 'text-orange-700' : ''}>{r.summary.requested} requested</strong>
                    {r.summary.superseded ? ` · ${r.summary.superseded} amended` : ''}
                    {r.summary.awaiting ? ` · ${r.summary.awaiting} waiting` : ''}
                  </span>
                )}
                <span className="ml-auto text-slate-400">{r.by}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
      {children}
    </div>
  )
}

function Toggle({ on, disabled, onChange, aria }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; aria: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={aria} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-60 ${
        on ? 'bg-orange-500' : 'bg-slate-300'
      }`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
        on ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  )
}

function RunReport({ run, details, showAll, onToggleAll }: {
  run: Run; details: Detail[]; showAll: boolean; onToggleAll: () => void
}) {
  const s = run.summary
  const ours = details.filter((d) => d.outcome !== 'not-in-system' && d.outcome !== 'no-is-number')
  const rows = (showAll ? details : ours).slice().sort((a, b) => OUTCOME_META[a.outcome].rank - OUTCOME_META[b.outcome].rank)

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
        {run.mode === 'detect'
          ? <><Eye className="w-3.5 h-3.5 text-slate-500" /> Preview — nothing was changed</>
          : <><ShieldCheck className="w-3.5 h-3.5 text-orange-600" /> Run complete</>}
        <span className="font-normal text-slate-400">
          · {run.dateField === 'arrival' ? 'arriving' : 'created'} {run.from} → {run.to} · {(run.durationMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Tile label="Cancelled in AS" value={s.upstream} />
        <Tile label="In our system" value={s.matched} />
        <Tile label={run.mode === 'detect' ? 'Would request' : 'Requested'}
          value={run.mode === 'detect' ? details.filter((d) => d.outcome === 'awaiting').length : s.requested}
          tone="orange" />
        <Tile label="Amended (kept)" value={s.superseded ?? 0} tone="sky" />
        <Tile label="Needs a person" value={details.filter((d) => d.outcome === 'on-ground' || d.outcome === 'unverified').length} tone="rose" />
        <Tile label="Already handled" value={details.filter((d) => ['already-requested', 'decided', 'closed-here'].includes(d.outcome)).length} />
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          {s.upstream === 0
            ? 'AppleSystem shows no cancelled quotations in this range.'
            : 'None of the cancelled quotations in this range is a booking we hold.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="py-1 pr-3 font-semibold">Booking</th>
                <th className="py-1 pr-3 font-semibold">Quotation</th>
                <th className="py-1 pr-3 font-semibold">Created</th>
                <th className="py-1 pr-3 font-semibold">Arrival</th>
                <th className="py-1 pr-3 font-semibold">Result</th>
                <th className="py-1 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d, i) => (
                <tr key={`${d.ref ?? 'x'}-${d.quotationNo}-${i}`} className="align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {d.ref && d.outcome !== 'not-in-system' ? (
                      <Link href={`/dashboard/bookings/${encodeURIComponent(d.ref)}`}
                        className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
                        {d.ref}<ExternalLink className="w-3 h-3 opacity-60" />
                      </Link>
                    ) : <span className="text-slate-400">{d.ref ?? '—'}</span>}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">{d.quotationNo || '—'}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-500">{d.createdOn ?? '—'}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-500">{d.arrivalDate ?? '—'}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${OUTCOME_META[d.outcome].chip}`}>
                      {run.mode === 'detect' && d.outcome === 'awaiting' ? 'Would request' : OUTCOME_META[d.outcome].label}
                    </span>
                  </td>
                  <td className="py-1.5 text-slate-500 leading-relaxed">{d.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {details.length > ours.length && (
        <button type="button" onClick={onToggleAll} className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700">
          {showAll ? 'Hide' : 'Show'} {details.length - ours.length} cancelled quotation{details.length - ours.length === 1 ? '' : 's'} we do not hold
        </button>
      )}

      {run.mode === 'detect' && details.some((d) => d.outcome === 'awaiting') && (
        <p className="text-[11px] text-amber-700 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          Press <strong>Find &amp; request to cancel</strong> to send these, or send them one at a time from the list below.
        </p>
      )}
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'orange' | 'sky' | 'rose' }) {
  const color = !value ? 'text-slate-400'
    : tone === 'orange' ? 'text-orange-700' : tone === 'sky' ? 'text-sky-700' : tone === 'rose' ? 'text-rose-700' : 'text-slate-800'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 truncate">{label}</p>
      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
