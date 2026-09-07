'use client'

/**
 * Booking Team Query Monitor.
 *
 * One screen over the whole pipeline: what the hourly sweep found in the file
 * handlers' mailboxes, what it wrote into the SharePoint query sheet, what it is
 * configured to do, and a full trace of every run.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, CheckCircle2, Clock, CloudUpload, ExternalLink,
  Inbox, Layers, Loader2, Mails, PlayCircle, RefreshCw, ScrollText, Settings2, Sparkles, Table2, Zap,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { cn, formatDateTime } from '@/lib/utils'
import { Stat, readJson } from './ui'
import QueriesTab from './queries-tab'
import ConfigTab from './config-tab'
import LogsTab from './logs-tab'
import AiUsageTab from './ai-usage-tab'
import DailyMailTab from './daily-mail-tab'
import type { QmConfig, QmSheetInfo, QmStats } from './types'

type TabId = 'queries' | 'daily' | 'config' | 'logs' | 'usage'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'queries', label: 'Queries',       icon: <Inbox className="w-4 h-4" /> },
  { id: 'daily',   label: 'Daily Mail',    icon: <Mails className="w-4 h-4" /> },
  { id: 'usage',   label: 'AI Usage',      icon: <Sparkles className="w-4 h-4" /> },
  { id: 'config',  label: 'Configuration', icon: <Settings2 className="w-4 h-4" /> },
  { id: 'logs',    label: 'Run Log',       icon: <ScrollText className="w-4 h-4" /> },
]

export default function QueryMonitorPage() {
  const [tab, setTab] = useState<TabId>('queries')

  const [config, setConfig]     = useState<QmConfig | null>(null)
  const [nextRunAt, setNextRun] = useState<string | null>(null)
  const [isRunning, setRunning] = useState(false)
  const [stats, setStats]       = useState<QmStats | null>(null)
  const [sheet, setSheet]       = useState<QmSheetInfo | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)

  const [busy, setBusy]       = useState<null | 'sync' | 'toggle' | 'dedupe' | 'retry'>(null)
  const [refreshKey, bump]    = useState(0)

  /**
   * A sweep we are waiting on, and whether the server has confirmed it started.
   *
   * `isRunning` is set optimistically the moment the button is pressed, so it
   * cannot on its own tell "not started yet" from "already finished" — and
   * reporting an outcome off the first would announce a sweep that never ran.
   * The outcome is only read once a poll has actually seen the run lock held.
   */
  const watchingSweep = useRef(false)
  const sawSweepStart = useRef(false)
  const wasRunning    = useRef(false)

  const loadSettings = useCallback(async () => {
    const res = await fetch('/api/query-monitor/settings')
    const d = await readJson(res)
    if (!d.success) { toast.error(d.error); return }
    setConfig(d.data.config)
    setNextRun(d.data.nextRunAt)
    setRunning(d.data.isRunning)
    if (d.data.isRunning) sawSweepStart.current = true
  }, [])

  const loadSheet = useCallback(async () => {
    setSheetError(null)
    const res = await fetch('/api/query-monitor/sheet?tail=0')
    const d = await readJson(res)
    if (!d.success) { setSheetError(d.error); setSheet(null); return }
    setSheet(d.data.info)
  }, [])

  useEffect(() => { void loadSettings(); void loadSheet() }, [loadSettings, loadSheet])

  // The sweep is a backend job — poll while one is in flight so the header stops
  // claiming "running" a minute after it finished.
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => { void loadSettings() }, 5_000)
    return () => clearInterval(id)
  }, [isRunning, loadSettings])

  /**
   * Report a sweep once the run lock clears, from the record it left behind.
   *
   * This is where the outcome of "Run now" actually comes from. It cannot come
   * from the button's own request: a sweep takes two minutes and the gateway in
   * front of this app hangs up long before that, so the response is a 504 — or
   * an HTML page — while the sweep itself carries on and finishes normally. The
   * run row is the only account of it that survives, and it is complete.
   */
  useEffect(() => {
    const ended = wasRunning.current && !isRunning
    wasRunning.current = isRunning
    if (!ended || !watchingSweep.current || !sawSweepStart.current) return

    watchingSweep.current = false
    sawSweepStart.current = false

    void (async () => {
      const res = await fetch('/api/query-monitor/runs?limit=1')
      const d   = await readJson(res)
      const run = d.success ? d.data.runs?.[0] : null

      if (!run) { toast.success('Sweep finished'); bump(k => k + 1); await loadSheet(); return }

      const detail = [
        `${run.entriesCreated} new`,
        `${run.rowsAppended} appended`,
        run.rowsUpdated ? `${run.rowsUpdated} rewritten` : null,
        run.errors ? `${run.errors} error${run.errors === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ')

      const seconds = run.durationMs ? ` in ${Math.round(run.durationMs / 1000)}s` : ''
      const line    = `Sweep ${String(run.status).toLowerCase()}${seconds} — ${detail}`

      if (run.status === 'FAILED')       toast.error(line, { duration: 10000 })
      else if (run.status === 'PARTIAL') toast.warning(line, { duration: 10000 })
      else                               toast.success(line, { duration: 8000 })

      bump(k => k + 1)
      await loadSheet()
    })()
  }, [isRunning, loadSheet])

  async function patchConfig(patch: Partial<QmConfig>, okMsg: string) {
    setBusy('toggle')
    try {
      const res = await fetch('/api/query-monitor/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const d = await readJson(res)
      if (!d.success) { toast.error(d.error); return }
      setConfig(d.data.config)
      toast.success(okMsg)
    } finally { setBusy(null) }
  }

  /**
   * Start a sweep and watch it, rather than sitting on the request until it
   * answers.
   *
   * A sweep reads nine mailboxes and runs for well over two minutes. The
   * gateway in front of this app gives up long before that and returns a 504,
   * so waiting for the response could only ever produce one of two things: a
   * timeout dressed up as a failure, or — for the rare fast sweep — a result.
   * The work itself was never the problem; it completes and writes its rows
   * either way.
   *
   * So the request is fired and deliberately not waited on. The screen switches
   * to watching the run lock, which is what the sweep actually holds, and the
   * outcome is read from the run record when that clears. The only answers worth
   * catching here are the immediate ones: a refusal, or a sweep short enough to
   * have already finished.
   */
  function runNow() {
    watchingSweep.current = true
    sawSweepStart.current = false
    setRunning(true)
    toast.info('Sweep started — this takes a couple of minutes. Watching it…')

    void (async () => {
      try {
        const res = await fetch('/api/query-monitor/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        })
        const d = await readJson(res)

        // Timed out at the gateway: expected, and says nothing about the sweep.
        // The watcher above reports it properly when the lock clears.
        if (d.timedOut) return

        // Refused outright — no lock was taken, so nothing will ever clear one.
        if (!d.success) {
          watchingSweep.current = false
          toast.error(d.error)
          await loadSettings()
          return
        }

        // Fast enough to answer. Let the watcher speak if it saw the lock;
        // otherwise the sweep was over before the first poll, so report it here.
        if (!sawSweepStart.current) {
          watchingSweep.current = false
          setRunning(false)
          toast.success(d.message ?? 'Sweep finished')
          bump(k => k + 1)
          await loadSheet()
        }
        await loadSettings()
      } catch {
        // A dropped connection is the same story as a 504 — the sweep is on the
        // server and the watcher is the thing that knows how it ended.
      }
    })()

    // Confirm the lock is held sooner than the 5-second poll would, so a sweep
    // that is refused or never starts does not leave the header claiming one is.
    setTimeout(() => { void loadSettings() }, 2000)
  }

  async function syncNow() {
    setBusy('sync')
    try {
      const res = await fetch('/api/query-monitor/sync', { method: 'POST' })
      const d = await readJson(res)
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Sheet updated')
      bump(k => k + 1)
      await loadSheet()
    } finally { setBusy(null) }
  }

  /**
   * Put the failed writes back in the queue and write them.
   *
   * Nothing else picks a FAILED row up — the sync looks for PENDING and DIRTY —
   * so without this they stay on screen with their error forever once the cause
   * is fixed. Rows that already own a line in the sheet go back as a rewrite,
   * not an append, so pressing this cannot duplicate them.
   */
  async function retryFailed() {
    setBusy('retry')
    try {
      const res = await fetch('/api/query-monitor/retry', { method: 'POST' })
      const d   = await readJson(res)
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Failed rows retried', { duration: 8000 })
      bump(k => k + 1)
      await loadSheet()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed')
    } finally { setBusy(null) }
  }

  /**
   * Take repeated lines out of the workbook by hand.
   *
   * Counted first and confirmed with the number, because the alternative is an
   * admin pressing a button that silently deletes rows from the live sheet.
   */
  async function removeDuplicates() {
    setBusy('dedupe')
    try {
      const preview = await fetch('/api/query-monitor/sheet-dedupe').then(readJson)
      if (!preview.success) { toast.error(preview.error); return }

      const count = preview.data.removed as number
      if (count === 0) { toast.success(preview.message ?? 'No duplicate rows found'); return }

      const ok = confirm(
        `${count} duplicate row(s) found on the sheet.\n\n`
        + 'The earliest line of each repeated query is kept; the later ones are deleted and '
        + 'everything below them moves up. Only columns A–N are touched.\n\n'
        + 'A row folded away takes any hand-typed edit on it with it. Remove them?',
      )
      if (!ok) return

      const res = await fetch('/api/query-monitor/sheet-dedupe', { method: 'POST' })
      const d   = await readJson(res)
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Duplicate rows removed')
      bump(k => k + 1)
      await loadSheet()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Duplicate sweep failed')
    } finally { setBusy(null) }
  }

  const awaiting = stats?.awaitingSync ?? 0

  return (
    <>
      <Header
        title="Booking Team Query Monitor"
        subtitle="Hourly sweep of the file-handler mailboxes into the SharePoint query sheet"
        actions={
          <div className="flex items-center gap-2">
            {sheet && (
              <a
                href={sheet.webUrl} target="_blank" rel="noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
              >
                <Table2 className="w-4 h-4" /> Open sheet <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={removeDuplicates} disabled={busy !== null}
              title="Delete repeated lines from the workbook, keeping the earliest of each query"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-50"
            >
              {busy === 'dedupe' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
              Remove duplicates
            </button>
            <button
              onClick={syncNow} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 disabled:opacity-50"
            >
              {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              Sync to sheet{awaiting > 0 ? ` (${awaiting})` : ''}
            </button>
            <button
              onClick={runNow} disabled={busy !== null || isRunning}
              title={isRunning ? 'A sweep is running — this button comes back when it finishes' : undefined}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              {isRunning ? 'Sweeping…' : 'Run now'}
            </button>
          </div>
        }
      />

      <div className="px-4 sm:px-8 py-6 space-y-6">
        {/* ── Live state strip ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat
            icon={config?.enabled ? <Zap className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
            tone={config?.enabled ? 'emerald' : 'slate'}
            label="Schedule"
            value={config?.enabled ? `Every ${config.intervalMinutes} min` : 'Paused'}
            hint={
              isRunning ? 'A sweep is running right now…'
              : config?.enabled && nextRunAt ? `Next ${formatDateTime(nextRunAt)}`
              : 'Switch it on under Configuration'
            }
          />
          <Stat
            icon={config?.autoWrite ? <CloudUpload className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            tone={config?.autoWrite ? 'sky' : 'amber'}
            label="Sheet writing"
            value={config?.autoWrite ? 'Automatic' : 'Review first'}
            hint={config?.autoWrite
              ? 'Each sweep appends straight to the workbook'
              : `${awaiting} row(s) held for review`}
          />
          <Stat
            icon={<Activity className="w-5 h-5" />}
            tone={(stats?.overdue ?? 0) > 0 ? 'rose' : 'emerald'}
            label="Open queries"
            value={(stats?.pending ?? 0) + (stats?.overdue ?? 0)}
            hint={`${stats?.overdue ?? 0} past the ${config?.slaHours ?? 2}h SLA · ${stats?.replied ?? 0} replied`
              + ((stats?.unassigned ?? 0) > 0 ? ` · ${stats?.unassigned} unassigned` : '')}
          />
          <Stat
            icon={sheetError ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            tone={sheetError ? 'rose' : 'emerald'}
            label="Workbook"
            value={sheetError ? 'Unreachable' : `${sheet?.dataRowCount.toLocaleString() ?? '—'} rows`}
            hint={sheetError ?? (sheet ? `"${sheet.sheetName}" · next write at row ${sheet.nextAppendRow}` : 'Checking…')}
          />
        </div>

        {/* Review-first banner — the single most important thing to know. */}
        {config && !config.autoWrite && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-900 flex-1 min-w-[16rem]">
              <span className="font-semibold">Review mode.</span>{' '}
              Sweeps collect and enrich queries but nothing reaches the master workbook until you press
              <span className="font-semibold"> Sync to sheet</span> — or turn on automatic writing once the rows look right.
            </p>
            <button
              onClick={() => patchConfig({ autoWrite: true }, 'Automatic sheet writing is on')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy === 'toggle' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              Turn on auto-write
            </button>
          </div>
        )}

        {/* Failed writes go nowhere on their own: the sync only looks at PENDING
            and DIRTY rows, so they need saying out loud and retrying by hand. */}
        {(stats?.failed ?? 0) > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex flex-wrap items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <p className="text-sm text-rose-900 flex-1 min-w-[16rem]">
              <span className="font-semibold">{stats?.failed} row(s) failed to write.</span>{' '}
              They stay here until they are retried — no sweep picks them up again.
              {sheet && !sheet.headerMatches
                ? ' Sort the header out first (below), then retry.'
                : ' Retry writes them all: rows that already have a line in the sheet are rewritten in place, not added twice.'}
            </p>
            <button
              onClick={retryFailed} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy === 'retry' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Retry failed writes
            </button>
          </div>
        )}

        {sheet && !sheet.headerMatches && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-rose-900">
              <span className="font-semibold">Column mismatch.</span>{' '}
              The header on “{sheet.sheetName}” no longer matches the expected
              Date / Status / Subject / … / File Handler / TO List / … / Region layout.
              Writing now would put values in the wrong columns, so nothing is written. In{' '}
              <span className="font-semibold">Configuration → Target workbook</span> either keep the header as it is
              and have the app write into your columns, or restore the standard layout — both keep every row that is
              already on the sheet.
            </p>
          </div>
        )}

        {/* ── Tabs ─────────────────────────────────────────────────────── */}
        <div className="border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors',
                tab === t.id
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {t.icon}{t.label}
            </button>
          ))}
          <button
            onClick={() => { bump(k => k + 1); void loadSettings(); void loadSheet() }}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {tab === 'queries' && <QueriesTab refreshKey={refreshKey} onStats={setStats} />}
        {tab === 'daily'   && <DailyMailTab refreshKey={refreshKey} />}
        {tab === 'usage'   && <AiUsageTab refreshKey={refreshKey} />}
        {tab === 'config'  && <ConfigTab config={config} onConfigChange={setConfig} onSheetChange={setSheet} />}
        {tab === 'logs'    && <LogsTab refreshKey={refreshKey} />}
      </div>
    </>
  )
}
