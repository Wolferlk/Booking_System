'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Radar, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  CalendarRange, Activity, Gauge, Sparkles, PackageCheck, XCircle,
  BellOff, ExternalLink, Repeat, MailCheck, Ban, ShieldAlert, Send, Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { fmtDateTime } from './shared'
import {
  relTime, REASON_LABEL, REASON_ACTION, isTransient, CANCEL_STATE_META,
  type WatchCheck, type WatchStatus, type WatchSettings,
  type CreatedEntry, type FailedEntry, type LedgerSource, type CancelEntry,
} from './watch-shared'

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
      const created  = json.data?.check?.created ?? 0
      const cancel   = json.data?.check?.cancel
      const withdrawn = (cancel?.requested ?? 0) + (cancel?.awaiting ?? 0)
      if (json.data?.check?.error) toast.error(json.message ?? 'AppleSystem unreachable')
      else if (created > 0) toast.success(json.message ?? `${created} imported`)
      else toast.info(json.message ?? 'No new confirmations')
      // Said separately: a sweep that imported nothing and found a cancellation
      // is not a quiet sweep, and the import toast would have called it one.
      if (withdrawn > 0) {
        toast.warning(
          cancel?.requested
            ? `${cancel.requested} booking${cancel.requested === 1 ? '' : 's'} sent for cancellation approval`
            : `${withdrawn} booking${withdrawn === 1 ? '' : 's'} cancelled in AppleSystem — waiting for you below`,
        )
      }
    } catch {
      toast.error('Network error during fetch')
    } finally {
      setFetching(false)
    }
  }, [])

  /**
   * The cancellation switch is saved through the same settings endpoint but is
   * deliberately not part of `WatchSettings` — it gates an action on existing
   * bookings rather than the sweep, so it is sent and echoed on its own.
   */
  const saveCancelAction = useCallback(async (on: boolean) => {
    if (!status) return
    setSaving(true)
    setStatus({ ...status, cancellations: { ...status.cancellations, actionEnabled: on } })
    try {
      const res = await fetch('/api/as-bookings-v2/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelActionEnabled: on }),
      })
      const json = await readApiResponse<{ cancelActionEnabled: boolean }>(res)
      if (!json.success) toast.error(json.error ?? 'Could not save')
      else toast.success(on
        ? 'Upstream cancellations will now be sent for accounts approval'
        : 'Cancellations will be detected and listed only')
    } catch {
      toast.error('Network error saving settings')
    } finally {
      setSaving(false)
      await load(true)
    }
  }, [status, load])

  /** Send one detected cancellation to accounts, under this user's name. */
  const requestCancel = useCallback(async (ref: string) => {
    try {
      const res = await fetch('/api/as-bookings-v2/watch/cancellations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref }),
      })
      const json = await readApiResponse<{ status: WatchStatus }>(res)
      if (!json.success) { toast.error(json.error ?? 'Could not send for approval'); return }
      if (json.data?.status) setStatus(json.data.status)
      toast.success(json.message ?? `${ref} sent for approval`)
    } catch {
      toast.error('Network error sending the cancellation')
    }
  }, [])

  /** Clear a settled row from the panel. The booking is never touched. */
  const clearCancel = useCallback(async (ref: string) => {
    try {
      const res = await fetch(
        `/api/as-bookings-v2/watch/cancellations?ref=${encodeURIComponent(ref)}`,
        { method: 'DELETE' },
      )
      const json = await readApiResponse<{ status: WatchStatus }>(res)
      if (!json.success) { toast.error(json.error ?? 'Could not clear the row'); return }
      if (json.data?.status) setStatus(json.data.status)
    } catch {
      toast.error('Network error clearing the row')
    }
  }, [])

  /**
   * Stop a quotation being re-announced. It keeps being retried — dismissing is
   * a statement about notifications, not about the import.
   */
  const dismiss = useCallback(async (quotationNo: string) => {
    try {
      const res = await fetch(
        `/api/as-bookings-v2/watch/ledger?quotation_no=${encodeURIComponent(quotationNo)}`,
        { method: 'DELETE' },
      )
      const json = await readApiResponse<{ dismissed: boolean }>(res)
      if (!json.success) { toast.error(json.error ?? 'Could not dismiss'); return }
      toast.success(json.message ?? `Quotation ${quotationNo} dismissed`)
      await load(true)
    } catch {
      toast.error('Network error dismissing the quotation')
    }
  }, [load])

  const s = status?.settings
  const enabled = !!s?.enabled

  // "Open" is anything nobody has settled: waiting on a person, waiting on
  // accounts, or a request that failed. Approved and declined rows are history.
  const openCancellations = (status?.cancellations?.entries ?? [])
    .filter((e) => e.state === 'awaiting' || e.state === 'requested' || e.state === 'failed').length

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
                  6&nbsp;AM job to pick it up the next morning. The same call also catches the ones
                  AppleSystem has <span className="font-medium">cancelled</span>, and puts those in
                  front of accounts. Runs on the server, so it works with nobody logged in.
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
          <div className="relative grid grid-cols-2 lg:grid-cols-5 gap-3 mt-5 pt-5 border-t border-slate-100">
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
              icon={<Ban className="w-3.5 h-3.5" />}
              label="Cancelled upstream"
              value={String(openCancellations)}
              hint={openCancellations > 0
                ? 'Open in the cancellation panel below'
                : 'Nothing withdrawn in this window'}
              tone={openCancellations > 0 ? 'bad' : 'muted'}
            />
            <Metric
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
              label="Problems"
              value={String(status?.totals.errors ?? 0)}
              hint={(status?.totals.errors ?? 0) > 0
                ? 'Distinct bookings stuck — see "Could not import"'
                : 'No failures recorded'}
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

      {/* ── What the importer actually did ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CreatedPanel entries={status?.ledger?.created ?? []} now={now} />
        <FailedPanel entries={status?.ledger?.failed ?? []} now={now} onDismiss={dismiss} />
      </div>

      {/* ── Cancelled in AppleSystem ─────────────────────────────────────── */}
      <CancellationPanel
        entries={status?.cancellations?.entries ?? []}
        actionEnabled={!!status?.cancellations?.actionEnabled}
        saving={saving}
        now={now}
        onToggleAction={saveCancelAction}
        onRequest={requestCancel}
        onClear={clearCancel}
      />

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

const SOURCE_LABEL: Record<LedgerSource, string> = {
  watch:     'Live watch',
  reconcile: 'Reconciliation',
  import:    'Daily import',
}

/**
 * Bookings the importer created, one row each.
 *
 * The check log above says "3 bookings created" and lists bare refs; this says
 * *which* bookings, for whom, arriving when, and from which quotation — so the
 * page answers "did my confirmation come through?" without a second lookup.
 */
function CreatedPanel({ entries, now }: { entries: CreatedEntry[]; now: number }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PackageCheck className="w-4 h-4 text-emerald-500" />
          <h4 className="text-sm font-semibold text-slate-900">Bookings created</h4>
        </div>
        {entries.length > 0 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 tabular-nums">
            {entries.length}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
        Every booking any AppleSystem import path has created here, newest first.
      </p>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-400 mt-4">
          Nothing created yet. New confirmations appear here the moment they import.
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5 max-h-[22rem] overflow-y-auto pr-1">
          {entries.map((e) => (
            <li
              key={e.ref}
              className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/dashboard/bookings/${encodeURIComponent(e.ref)}`}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800 hover:underline tabular-nums"
                    >
                      {e.ref}
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </Link>
                    {e.country && (
                      <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {e.country}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {e.guestName ? `${e.guestName} · ` : ''}
                    {e.arrivalDate ? `arrives ${e.arrivalDate} · ` : ''}
                    quotation {e.quotationNo}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-slate-400 tabular-nums" title={fmtDateTime(e.at)}>
                  {relTime(now - Date.parse(e.at))} ago
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">
                {SOURCE_LABEL[e.source] ?? e.source}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const CANCEL_TONE: Record<string, { chip: string; card: string }> = {
  wait:  { chip: 'bg-amber-100 text-amber-800',     card: 'border-amber-200 bg-amber-50/50' },
  sent:  { chip: 'bg-orange-100 text-orange-800',   card: 'border-orange-200 bg-orange-50/50' },
  done:  { chip: 'bg-slate-100 text-slate-600',     card: 'border-slate-200 bg-white' },
  clash: { chip: 'bg-rose-100 text-rose-700',       card: 'border-rose-200 bg-rose-50/50' },
  muted: { chip: 'bg-slate-100 text-slate-500',     card: 'border-slate-200 bg-white' },
}

/**
 * What AppleSystem has withdrawn, and what became of it here.
 *
 * The panel is built around one fact: **nothing on it cancels a booking.** A
 * detection moves the file to "Pending Approval — Accounts Team (Cancelling)"
 * and emails the desk, exactly as a person's cancellation does — so every row
 * reads as a request with a decision still outstanding, and the states that are
 * *finished* (approved, declined) are visually quieter than the ones that are
 * not.
 *
 * The switch at the top is the whole safety argument in one control: detection
 * always runs, so the list is complete either way; only the sending is gated.
 * That is what makes it safe to turn on against a live book — the first sweep
 * shows you the backlog instead of mailing it to accounts.
 */
function CancellationPanel({
  entries, actionEnabled, saving, now, onToggleAction, onRequest, onClear,
}: {
  entries: CancelEntry[]
  actionEnabled: boolean
  saving: boolean
  now: number
  onToggleAction: (on: boolean) => void
  onRequest: (ref: string) => Promise<void>
  onClear: (ref: string) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)

  const open   = entries.filter((e) => e.state === 'awaiting' || e.state === 'requested' || e.state === 'failed')
  const closed = entries.filter((e) => e.state === 'approved' || e.state === 'declined' || e.state === 'skipped')
  const waiting = entries.filter((e) => e.state === 'awaiting').length

  const run = async (ref: string, fn: (r: string) => Promise<void>) => {
    setBusy(ref)
    try { await fn(ref) } finally { setBusy(null) }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Ban className="w-4 h-4 text-rose-500" />
            <h4 className="text-sm font-semibold text-slate-900">Cancelled in AppleSystem</h4>
            {open.length > 0 && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 tabular-nums">
                {open.length}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed max-w-2xl">
            The same sweep that imports confirmations also spots the quotations AppleSystem has
            withdrawn. A booking we hold for one of them is <span className="font-medium">never
            cancelled automatically</span> — money has usually moved by then. It is moved to{' '}
            <span className="font-medium">Pending Approval — Accounts Team (Cancelling)</span>,
            attributed to AppleSystem, and the accounts desk decides.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Send for approval
            </p>
            <p className="text-[11px] text-slate-400">
              {actionEnabled ? 'Automatic' : 'Detect and list only'}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={actionEnabled}
            aria-label="Automatically send upstream cancellations for accounts approval"
            disabled={saving}
            onClick={() => onToggleAction(!actionEnabled)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
              actionEnabled ? 'bg-rose-500' : 'bg-slate-300'
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              actionEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {!actionEnabled && waiting > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
          <span>
            {waiting} booking{waiting === 1 ? ' is' : 's are'} cancelled upstream and still live here.
            Send them one at a time with the button on each row, or switch the control above on and the
            next sweep will send them all.
          </span>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-slate-400 mt-4">
          Nothing withdrawn. Every confirmation in the window is still confirmed upstream.
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5 max-h-[26rem] overflow-y-auto pr-1">
          {[...open, ...closed].map((e) => {
            const meta = CANCEL_STATE_META[e.state]
            const tone = CANCEL_TONE[meta.tone] ?? CANCEL_TONE.muted
            const canSend = e.state === 'awaiting' || e.state === 'failed'
            const settled = e.state === 'approved' || e.state === 'declined' || e.state === 'skipped'
            return (
              <li key={e.ref} className={`rounded-xl border px-3.5 py-2.5 ${tone.card}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/dashboard/bookings/${encodeURIComponent(e.ref)}`}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800 hover:underline tabular-nums"
                      >
                        {e.ref}
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </Link>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone.chip}`}>
                        {meta.label}
                      </span>
                      {e.country && (
                        <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          {e.country}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-500 mt-1 truncate">
                      {e.guestName ? `${e.guestName} · ` : ''}
                      {e.arrivalDate ? `arrives ${e.arrivalDate} · ` : ''}
                      quotation {e.quotationNo || '—'} · upstream status {e.upstreamStatus}
                      {e.upstreamClass ? ` (${e.upstreamClass})` : ''}
                      {e.prevStatus ? ` · was ${e.prevStatus.replace(/_/g, ' ').toLowerCase()}` : ''}
                    </p>

                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      {e.note ?? meta.blurb}
                    </p>

                    {e.actedBy && e.requestedAt && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Sent by {e.actedBy} · {fmtDateTime(e.requestedAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-[11px] text-slate-400 tabular-nums" title={fmtDateTime(e.detectedAt)}>
                      {relTime(now - Date.parse(e.detectedAt))} ago
                    </span>

                    {canSend && (
                      <button
                        onClick={() => void run(e.ref, onRequest)}
                        disabled={busy === e.ref}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                        title="Move this booking to Pending Approval — Accounts Team (Cancelling) and email the desk"
                      >
                        {busy === e.ref
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Send className="w-3 h-3" />}
                        Send for approval
                      </button>
                    )}

                    {e.state === 'requested' && (
                      <Link
                        href="/dashboard/accounts/cancellations"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-orange-700 transition-colors hover:bg-orange-50"
                      >
                        <MailCheck className="w-3 h-3" /> Accounts queue
                      </Link>
                    )}

                    {settled && (
                      <button
                        onClick={() => void run(e.ref, onClear)}
                        disabled={busy === e.ref}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                        title="Clear this row from the list — the booking is not touched"
                      >
                        <Trash2 className="w-3 h-3" /> Clear
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/**
 * Quotations that could not be imported — **one row per booking, not per retry**.
 *
 * This is the panel the page was missing. Previously a stuck confirmation showed
 * up only as "2 failed, will retry" on every check row and as a repeating alert
 * in everyone's inbox, with the quotation number nowhere on screen. Here each
 * problem quotation appears once, with the reason, what to do about it, how many
 * times it has been retried, and whether anyone has already been told.
 */
function FailedPanel({
  entries, now, onDismiss,
}: {
  entries: FailedEntry[]
  now: number
  onDismiss: (quotationNo: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const open = entries.filter((e) => !e.dismissedAt)
  const dismissed = entries.filter((e) => e.dismissedAt)

  const handle = async (q: string) => {
    setBusy(q)
    try { await onDismiss(q) } finally { setBusy(null) }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4 text-amber-500" />
          <h4 className="text-sm font-semibold text-slate-900">Could not import</h4>
        </div>
        {open.length > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 tabular-nums">
            {open.length}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
        One row per quotation, however many times it has been retried. Each is
        emailed <span className="font-medium">once</span> — repeats are listed here and nowhere else.
      </p>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-400 mt-4">
          Nothing is stuck. Every confirmation in the window imported cleanly.
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5 max-h-[22rem] overflow-y-auto pr-1">
          {[...open, ...dismissed].map((e) => {
            const transient = isTransient(e.reason)
            const done = !!e.dismissedAt
            return (
              <li
                key={`${e.quotationNo}:${e.reason}`}
                className={`rounded-xl border px-3 py-2 ${
                  done       ? 'border-slate-100 bg-slate-50/60 opacity-70'
                  : transient ? 'border-slate-200 bg-white'
                              : 'border-amber-100 bg-amber-50/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800 tabular-nums">
                        Quotation {e.quotationNo}
                      </span>
                      {e.ref && (
                        <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 tabular-nums">
                          {e.ref}
                        </span>
                      )}
                      {e.country && (
                        <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          {e.country}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs font-medium mt-1 ${done ? 'text-slate-500' : transient ? 'text-slate-600' : 'text-amber-800'}`}>
                      {REASON_LABEL[e.reason] ?? 'Could not be imported'}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      {REASON_ACTION[e.reason]}
                    </p>
                    {e.message && (
                      <p className="text-[11px] text-slate-400 mt-1 italic break-words">{e.message}</p>
                    )}
                  </div>

                  {!done && (
                    <button
                      onClick={() => void handle(e.quotationNo)}
                      disabled={busy === e.quotationNo}
                      title="Stop listing and announcing this quotation. It keeps being retried."
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy === e.quotationNo
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <BellOff className="w-3 h-3" />}
                      Dismiss
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-slate-400 tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <Repeat className="w-3 h-3" />
                    {e.attempts} attempt{e.attempts === 1 ? '' : 's'}
                  </span>
                  <span title={fmtDateTime(e.firstAt)}>
                    first {relTime(now - Date.parse(e.firstAt))} ago
                  </span>
                  <span title={fmtDateTime(e.lastAt)}>
                    last {relTime(now - Date.parse(e.lastAt))} ago
                  </span>
                  <span>{SOURCE_LABEL[e.source] ?? e.source}</span>
                  {e.notifiedAt && (
                    <span className="inline-flex items-center gap-1 text-slate-400" title={`Emailed ${fmtDateTime(e.notifiedAt)}`}>
                      <MailCheck className="w-3 h-3" /> emailed once
                    </span>
                  )}
                  {done && (
                    <span className="text-slate-400">
                      dismissed{e.dismissedBy ? ` by ${e.dismissedBy}` : ''}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}


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
            <span className="ml-1.5 text-amber-700">
              · {c.errors} failed
              {c.failedQuotations?.length
                ? ` (q${Array.from(new Set(c.failedQuotations)).join(', q')})`
                : ''}
            </span>
          )}
          {/* The withdrawal side of the same tick. Only ever shown when it
              found something — a check that cancelled nothing should read
              exactly as it always did. */}
          {!!c.cancel && (c.cancel.requested > 0 || c.cancel.awaiting > 0) && (
            <span className="ml-1.5 text-rose-700">
              · {c.cancel.requested > 0
                  ? `${c.cancel.requested} sent for cancel approval${c.cancel.refs.length ? ` (${c.cancel.refs.join(', ')})` : ''}`
                  : `${c.cancel.awaiting} cancelled upstream, waiting for a person`}
            </span>
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
