'use client'

/**
 * Booking Team Query Monitor.
 *
 * One screen over the whole pipeline: what the hourly sweep found in the file
 * handlers' mailboxes, what it wrote into the SharePoint query sheet, what it is
 * configured to do, and a full trace of every run.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, CheckCircle2, Clock, CloudUpload, ExternalLink,
  Inbox, Layers, Loader2, PlayCircle, RefreshCw, ScrollText, Settings2, Table2, Zap,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { cn, formatDateTime } from '@/lib/utils'
import { Stat } from './ui'
import QueriesTab from './queries-tab'
import ConfigTab from './config-tab'
import LogsTab from './logs-tab'
import type { QmConfig, QmSheetInfo, QmStats } from './types'

type TabId = 'queries' | 'config' | 'logs'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'queries', label: 'Queries',       icon: <Inbox className="w-4 h-4" /> },
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

  const [busy, setBusy]       = useState<null | 'run' | 'sync' | 'toggle' | 'dedupe'>(null)
  const [refreshKey, bump]    = useState(0)

  const loadSettings = useCallback(async () => {
    const res = await fetch('/api/query-monitor/settings')
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    setConfig(d.data.config)
    setNextRun(d.data.nextRunAt)
    setRunning(d.data.isRunning)
  }, [])

  const loadSheet = useCallback(async () => {
    setSheetError(null)
    const res = await fetch('/api/query-monitor/sheet?tail=0')
    const d = await res.json()
    if (!d.success) { setSheetError(d.error); setSheet(null); return }
    setSheet(d.data.info)
  }, [])

  useEffect(() => { void loadSettings(); void loadSheet() }, [loadSettings, loadSheet])

  // The sweep is a backend job — poll while one is in flight so the header stops
  // claiming "running" a minute after it finished.
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => { void loadSettings() }, 10_000)
    return () => clearInterval(id)
  }, [isRunning, loadSettings])

  async function patchConfig(patch: Partial<QmConfig>, okMsg: string) {
    setBusy('toggle')
    try {
      const res = await fetch('/api/query-monitor/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setConfig(d.data.config)
      toast.success(okMsg)
    } finally { setBusy(null) }
  }

  async function runNow() {
    setBusy('run')
    toast.info('Sweeping the file-handler mailboxes…')
    try {
      const res = await fetch('/api/query-monitor/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Sweep finished')
      bump(k => k + 1)
      await loadSettings()
      await loadSheet()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sweep failed')
    } finally { setBusy(null) }
  }

  async function syncNow() {
    setBusy('sync')
    try {
      const res = await fetch('/api/query-monitor/sync', { method: 'POST' })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Sheet updated')
      bump(k => k + 1)
      await loadSheet()
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
      const preview = await fetch('/api/query-monitor/sheet-dedupe').then(r => r.json())
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
      const d   = await res.json()
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
              onClick={runNow} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              Run now
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

        {sheet && !sheet.headerMatches && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-rose-900">
              <span className="font-semibold">Column mismatch.</span>{' '}
              The header on “{sheet.sheetName}” no longer matches the expected
              Date / Status / Subject / … / File Handler / TO List / … / Region layout.
              Writing now would put values in the wrong columns — check the Configuration tab before syncing.
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
        {tab === 'config'  && <ConfigTab config={config} onConfigChange={setConfig} onSheetChange={setSheet} />}
        {tab === 'logs'    && <LogsTab refreshKey={refreshKey} />}
      </div>
    </>
  )
}
