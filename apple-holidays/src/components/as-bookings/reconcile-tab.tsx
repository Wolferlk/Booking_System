'use client'

/**
 * **Parity Check** — the reconciliation tab.
 *
 * Every other tab on this page is about *getting bookings in*. This one is about
 * proving none were lost, so it is built around a single claim the reader is
 * either reassured or alarmed by within a second of arriving:
 *
 *     AppleSystem confirmed 24  ·  the system holds 24
 *
 * Everything below that headline exists to explain a gap or to evidence that
 * there wasn't one. The controls are secondary and sit under the verdict, not
 * above it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ShieldCheck, ShieldAlert, Loader2, RefreshCw, AlertTriangle, CheckCircle2,
  Clock, CalendarRange, XCircle, Sparkles, Ban, Flag, PlusCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { fmtDateTime } from './shared'
import { relTime } from './watch-shared'
import type {
  ReconcileStatus, ReconcileSettings, ReconcileRun, ReconcileAction,
} from './reconcile-shared'

const INTERVAL_PRESETS = [5, 10, 15, 30, 60] as const
const LOOKBACK_PRESETS = [1, 2, 3, 7, 14] as const

/** Re-renders once a second so the countdown stays live without refetching. */
function useTicker(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const ACTION_STYLE: Record<ReconcileAction['kind'], { icon: typeof PlusCircle; cls: string; label: string }> = {
  created:   { icon: PlusCircle,   cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', label: 'Imported' },
  refreshed: { icon: Sparkles,     cls: 'text-blue-600 bg-blue-50 border-blue-200',          label: 'Refreshed' },
  cancelled: { icon: Ban,          cls: 'text-amber-700 bg-amber-50 border-amber-200',       label: 'Cancelled' },
  flagged:   { icon: Flag,         cls: 'text-orange-600 bg-orange-50 border-orange-200',    label: 'Flagged' },
  error:     { icon: XCircle,      cls: 'text-red-600 bg-red-50 border-red-200',             label: 'Failed' },
}

function Stat({ label, value, tone = 'slate', note }: {
  label: string; value: number | string; tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue'; note?: string
}) {
  const tones = {
    slate: 'text-slate-900', green: 'text-emerald-600', red: 'text-red-600',
    amber: 'text-amber-600', blue: 'text-blue-600',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <div className={`text-2xl font-extrabold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{label}</div>
      {note && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{note}</div>}
    </div>
  )
}

export default function ReconcileTab() {
  const [status, setStatus]   = useState<ReconcileStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [openRun, setOpenRun] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const now = useTicker()

  const load = useCallback(async (quiet = false) => {
    try {
      const res  = await fetch('/api/as-bookings-v2/reconcile')
      const json = await readApiResponse<ReconcileStatus>(res)
      if (json.success && json.data) { setStatus(json.data); setError(null) }
      else if (!quiet) setError(json.error ?? 'Could not load reconciliation status')
    } catch {
      if (!quiet) setError('Network error loading reconciliation status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // The loop runs server-side; keep the panel honest while it is open.
    pollRef.current = setInterval(() => { void load(true) }, 20_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load])

  const save = useCallback(async (patch: Partial<ReconcileSettings>) => {
    if (!status) return
    const next = { ...status.settings, ...patch }
    setSaving(true)
    setStatus({ ...status, settings: next })   // optimistic
    try {
      const res = await fetch('/api/as-bookings-v2/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await readApiResponse<{ settings: ReconcileSettings }>(res)
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
      const res  = await fetch('/api/as-bookings-v2/reconcile/run', { method: 'POST' })
      const json = await readApiResponse<{ ran: boolean; run?: ReconcileRun; status: ReconcileStatus }>(res)
      if (!json.success) { toast.error(json.error ?? 'Reconciliation failed'); return }
      if (json.data?.status) setStatus(json.data.status)
      const run = json.data?.run
      if (run?.error) toast.error(json.message ?? 'AppleSystem unreachable')
      else if (run && !run.inParity) toast.warning(json.message ?? 'Parity gap found')
      else toast.success(json.message ?? 'In parity')
    } catch {
      toast.error('Network error during reconciliation')
    } finally {
      setRunning(false)
    }
  }, [])

  const s = status?.settings
  const enabled = !!s?.enabled

  const countdown = useMemo(() => {
    if (!status?.nextRunAt || !enabled) return null
    const due = Date.parse(status.nextRunAt) - now
    return due <= 0 ? 'due now' : relTime(due)
  }, [status?.nextRunAt, enabled, now])

  // The headline pair. Today's ledger row is the day the user cares about; when
  // the reconciler has not written one yet, the last run's own numbers stand in
  // so the panel is never blank on a freshly deployed system.
  const parity = useMemo(() => {
    const today = status?.today
    if (today) {
      return {
        upstream: today.upstreamConfirmed,
        held: today.systemHeld,
        missing: today.missing,
        refs: today.missingRefs,
        scope: `created ${today.date}`,
      }
    }
    const run = status?.lastRun
    if (run) {
      return {
        upstream: run.upstreamConfirmed,
        held: run.upstreamConfirmed - run.unresolved,
        missing: run.unresolved,
        refs: run.unresolvedRefs,
        scope: `created ${run.windowFrom === run.windowTo ? run.windowFrom : `${run.windowFrom} → ${run.windowTo}`}`,
      }
    }
    return null
  }, [status])

  const inParity = !!parity && parity.missing === 0

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

      {/* ── The verdict ──────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className={`relative p-5 sm:p-6 ${inParity ? 'bg-gradient-to-br from-emerald-50/60 to-transparent' : parity ? 'bg-gradient-to-br from-red-50/60 to-transparent' : ''}`}>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5">
            <div className="flex items-start gap-4 min-w-0">
              <div className={`relative shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${
                !parity      ? 'bg-slate-100 text-slate-400'
                  : inParity ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                             : 'bg-red-500 text-white shadow-lg shadow-red-500/25'
              }`}>
                {status?.running
                  ? <Loader2 className="w-6 h-6 animate-spin" />
                  : inParity ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
              </div>

              <div className="min-w-0">
                {parity ? (
                  <>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-3xl font-extrabold tabular-nums ${inParity ? 'text-emerald-600' : 'text-red-600'}`}>
                        {parity.held}
                      </span>
                      <span className="text-2xl font-bold text-slate-300">/</span>
                      <span className="text-3xl font-extrabold tabular-nums text-slate-900">{parity.upstream}</span>
                      <span className="text-sm font-semibold text-slate-500">confirmations in the system</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5 max-w-xl leading-relaxed">
                      {inParity ? (
                        <>Every AppleSystem <span className="font-medium">confirmed (Status&nbsp;2)</span> quotation{' '}
                        {parity.scope} is in the booking system. Nothing was missed.</>
                      ) : (
                        <><span className="font-semibold text-red-600">{parity.missing} missing</span> — AppleSystem
                        confirmed {parity.upstream} {parity.scope}, this system holds {parity.held}. The next run
                        retries automatically.</>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="font-semibold text-slate-900">Parity check</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">
                      Every {s?.intervalMinutes ?? 15} minutes this re-lists AppleSystem&apos;s confirmations for the
                      last {s?.lookbackDays ?? 2} day{(s?.lookbackDays ?? 2) === 1 ? '' : 's'} and checks each one against the
                      booking system — importing what is missing, refreshing what was amended and cancelling what
                      was withdrawn. Run it once to see the first result.
                    </p>
                  </>
                )}

                <div className="flex items-center gap-3 flex-wrap mt-2.5 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {status?.lastRunAt ? `checked ${relTime(now - Date.parse(status.lastRunAt))} ago` : 'never run'}
                  </span>
                  {countdown && <span className="inline-flex items-center gap-1">next in {countdown}</span>}
                  <span className="inline-flex items-center gap-1">
                    <CalendarRange className="w-3 h-3" />
                    {status?.window.from} → {status?.window.to}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={runNow}
                disabled={running}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin text-brand-500' : 'text-slate-400'}`} />
                {running ? 'Reconciling…' : 'Reconcile now'}
              </button>

              <button
                role="switch"
                aria-checked={enabled}
                aria-label="Toggle automatic reconciliation"
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

          {/* The gap, named. A count nobody can act on is not a finding. */}
          {parity && parity.missing > 0 && parity.refs.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-red-700 mb-1.5">
                Not in the booking system
              </div>
              <div className="flex flex-wrap gap-1.5">
                {parity.refs.map((ref) => (
                  <span key={ref} className="rounded-lg border border-red-200 bg-white px-2 py-0.5 text-xs font-semibold text-red-700">
                    {ref}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── What the automation has been doing ───────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Imported" value={status?.today?.createdTotal ?? 0} tone="green" note="missing → created" />
        <Stat label="Refreshed" value={status?.today?.refreshedTotal ?? 0} tone="blue" note="amended upstream" />
        <Stat label="Cancelled" value={status?.today?.cancelledTotal ?? 0} tone="amber" note="withdrawn upstream" />
        <Stat label="Flagged" value={status?.today?.flaggedTotal ?? 0} tone="amber" note="needs a person" />
        <Stat label="Runs today" value={status?.today?.runs ?? 0} note={`errors ${status?.today?.errorsTotal ?? 0}`} />
      </div>

      {/* ── Settings ─────────────────────────────────────────────────────── */}
      <Card className="p-5 space-y-5">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">How often, and how far back</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            The window is a <span className="font-medium">create-date</span> range. Looking back more than one day
            catches a quotation created yesterday but confirmed today, which a today-only check would never see.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Check every</div>
            <div className="flex flex-wrap gap-1.5">
              {INTERVAL_PRESETS.map((m) => (
                <button
                  key={m}
                  disabled={saving}
                  onClick={() => save({ intervalMinutes: m })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                    s?.intervalMinutes === m ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Look back</div>
            <div className="flex flex-wrap gap-1.5">
              {LOOKBACK_PRESETS.map((d) => (
                <button
                  key={d}
                  disabled={saving}
                  onClick={() => save({ lookbackDays: d })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                    s?.lookbackDays === d ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {d} day{d === 1 ? '' : 's'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5 space-y-3">
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800">Refresh amended bookings</div>
              <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                When AppleSystem changes a confirmation we already hold, re-read it and update the dates, pax,
                hotels and itinerary in place. Workflow status, tickets, drivers, agenda, P&amp;L and payments are
                never touched, and a field AppleSystem sends empty never blanks what ops typed in.
              </div>
            </div>
            <button
              role="switch"
              aria-checked={!!s?.refreshEnabled}
              disabled={saving}
              onClick={() => save({ refreshEnabled: !s?.refreshEnabled })}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                s?.refreshEnabled ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                s?.refreshEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </label>

          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800">Cancel withdrawn confirmations</div>
              <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                A booking here whose AppleSystem quotation is no longer Status&nbsp;2 was confirmed once and has
                since been withdrawn. With this on it is marked cancelled — but only after being seen off Status&nbsp;2
                on <span className="font-medium">two separate runs</span>, never if the tour has already started,
                and never over a cancellation a person is already handling. Nothing is deleted: the previous status
                is recorded, so it can be reversed. Turn this off to detect and report the drift without acting on it.
              </div>
            </div>
            <button
              role="switch"
              aria-checked={!!s?.autoCancelEnabled}
              disabled={saving}
              onClick={() => save({ autoCancelEnabled: !s?.autoCancelEnabled })}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                s?.autoCancelEnabled ? 'bg-amber-500' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                s?.autoCancelEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </label>
        </div>
      </Card>

      {/* ── Per-day ledger ───────────────────────────────────────────────── */}
      {!!status?.days.length && (
        <Card className="p-5">
          <h4 className="text-sm font-semibold text-slate-900 mb-3">Day by day</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="text-left py-2">Create date</th>
                  <th className="text-right py-2">AppleSystem</th>
                  <th className="text-right py-2">In system</th>
                  <th className="text-right py-2">Missing</th>
                  <th className="text-right py-2">Imported</th>
                  <th className="text-right py-2">Refreshed</th>
                  <th className="text-right py-2">Cancelled</th>
                  <th className="text-right py-2">Runs</th>
                </tr>
              </thead>
              <tbody>
                {status.days.map((d) => (
                  <tr key={d.date} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 font-medium text-slate-700">{d.date}</td>
                    <td className="py-2 text-right tabular-nums text-slate-600">{d.upstreamConfirmed}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-slate-900">{d.systemHeld}</td>
                    <td className={`py-2 text-right tabular-nums font-semibold ${d.missing ? 'text-red-600' : 'text-slate-300'}`}>
                      {d.missing || '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums text-emerald-600">{d.createdTotal || '—'}</td>
                    <td className="py-2 text-right tabular-nums text-blue-600">{d.refreshedTotal || '—'}</td>
                    <td className="py-2 text-right tabular-nums text-amber-600">{d.cancelledTotal || '—'}</td>
                    <td className="py-2 text-right tabular-nums text-slate-400">{d.runs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Run history ──────────────────────────────────────────────────── */}
      {!!status?.runs.length && (
        <Card className="p-5">
          <h4 className="text-sm font-semibold text-slate-900 mb-3">Recent runs</h4>
          <div className="space-y-1.5">
            {status.runs.map((r) => {
              const open = openRun === r.at
              const bad = !!r.error || r.unresolved > 0
              return (
                <div key={r.at} className="rounded-xl border border-slate-100 overflow-hidden">
                  <button
                    onClick={() => setOpenRun(open ? null : r.at)}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50 transition-colors"
                  >
                    {bad
                      ? <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                      : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />}
                    <span className="text-xs font-semibold text-slate-700 shrink-0">{fmtDateTime(r.at)}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">{r.trigger}</span>
                    <span className="text-xs text-slate-500 truncate">
                      {r.error
                        ? r.error
                        : `${r.upstreamConfirmed} confirmed · ${r.created} imported · ${r.refreshed} refreshed · ${r.cancelled} cancelled${r.unresolved ? ` · ${r.unresolved} still missing` : ''}`}
                    </span>
                    <span className="ml-auto text-[11px] text-slate-400 shrink-0">{Math.round(r.durationMs / 1000)}s</span>
                  </button>

                  {open && (
                    <div className="border-t border-slate-100 bg-slate-50/60 px-3.5 py-3 space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                        <div><span className="text-slate-400">Window</span> <span className="font-medium text-slate-700">{r.windowFrom} → {r.windowTo}</span></div>
                        <div><span className="text-slate-400">Scanned</span> <span className="font-medium text-slate-700">{r.scanned} rows</span></div>
                        <div><span className="text-slate-400">Already here</span> <span className="font-medium text-slate-700">{r.presentBefore}</span></div>
                        <div><span className="text-slate-400">Stale</span> <span className="font-medium text-slate-700">{r.stale}{r.refreshBacklog ? ` (${r.refreshBacklog} deferred)` : ''}</span></div>
                        <div><span className="text-slate-400">Drifted</span> <span className="font-medium text-slate-700">{r.drifted}</span></div>
                        <div><span className="text-slate-400">Awaiting 2nd sighting</span> <span className="font-medium text-slate-700">{r.awaitingSecondSighting}</span></div>
                        <div><span className="text-slate-400">Import errors</span> <span className="font-medium text-slate-700">{r.importErrors}</span></div>
                        <div><span className="text-slate-400">Sync errors</span> <span className="font-medium text-slate-700">{r.syncErrors}</span></div>
                      </div>

                      {r.actions.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {r.actions.map((a, i) => {
                            const st = ACTION_STYLE[a.kind]
                            const Icon = st.icon
                            return (
                              <div key={`${a.ref}-${i}`} className="flex items-start gap-2 text-xs">
                                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${st.cls}`}>
                                  <Icon className="w-3 h-3" />{st.label}
                                </span>
                                <span className="font-semibold text-slate-700 shrink-0">{a.ref}</span>
                                {a.detail && <span className="text-slate-500 truncate">{a.detail}</span>}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
