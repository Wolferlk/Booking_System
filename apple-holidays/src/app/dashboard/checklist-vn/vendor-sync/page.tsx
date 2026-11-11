'use client'

/**
 * VN Vendor Sync — the whole picture: every sweep, everything it wrote or
 * suggested, the settings, and "Sync all now". Per-booking detail lives on
 * each movement chart (components/agenda/vn-vendor-sync-panel.tsx).
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  RefreshCw, Loader2, Store, FileSpreadsheet, ArrowRight, Undo2, Search, Settings2, Database, CheckCircle2,
  AlertTriangle, Clock, Filter as FilterIcon, ShieldCheck, ChevronLeft, ChevronRight,
} from 'lucide-react'
import Header from '@/components/layout/header'
import VendorCompareBoard from '@/components/vn-vendor-sync/vendor-compare-board'
import { cn } from '@/lib/utils'
import {
  EVENT_ACTION, LINK_STATUS, timeAgo,
  type EventAction, type LinkStatus, type VendorSyncConfig, type VendorSyncEventInfo, type VendorSyncRunInfo,
} from '@/lib/vn-vendor-sync/shared'

interface LogPayload {
  installed: boolean
  canEdit: boolean
  isAdmin: boolean
  config?: VendorSyncConfig
  runs: VendorSyncRunInfo[]
  events: VendorSyncEventInfo[]
  total: number
  totals: Record<string, number>
}

const ACTIONS: EventAction[] = ['APPLIED', 'UPDATED', 'EDITED', 'REVERTED', 'SUGGESTED', 'KEPT_MANUAL', 'SHEET_DROPPED', 'UNDONE', 'IGNORED', 'RESTORED']

function RunRow({ r, isAdmin, onUndo, onPick, picked }: {
  r: VendorSyncRunInfo; isAdmin: boolean; onUndo: (r: VendorSyncRunInfo) => void; onPick: (id: string) => void; picked: boolean
}) {
  const tone = r.status === 'FAILED' ? 'bg-rose-500' : r.status === 'RUNNING' ? 'bg-sky-400 animate-pulse' : r.applied + r.updated > 0 ? 'bg-emerald-500' : 'bg-slate-300'
  return (
    <li className={cn('flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs transition hover:bg-slate-50', picked && 'bg-teal-50/60')}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', tone)} />
      <button type="button" onClick={() => onPick(r.id)} className="min-w-[150px] text-left">
        <p className="font-semibold text-slate-800">{new Date(r.startedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
        <p className="text-[10.5px] text-slate-400">
          {r.trigger === 'CRON' ? 'Every 15 min' : r.trigger === 'MANUAL' ? `Fetch now · ${r.triggeredBy ?? ''}` : 'On open'}
          {r.scope !== 'ALL' && ` · ${r.scope}`}{r.durationMs !== null && ` · ${(r.durationMs / 1000).toFixed(1)} s`}
        </p>
      </button>
      <div className="flex flex-wrap gap-1.5">
        {r.applied > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">{r.applied} applied</span>}
        {r.updated > 0 && <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700 ring-1 ring-sky-200">{r.updated} updated</span>}
        {r.suggested > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">{r.suggested} to review</span>}
        {r.keptManual > 0 && <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700 ring-1 ring-violet-200">{r.keptManual} kept</span>}
        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-500 ring-1 ring-slate-200">{r.bookings} bookings · {r.movements} movements · {r.inSync} match</span>
      </div>
      <p className="min-w-0 flex-1 truncate text-[10.5px] text-slate-400" title={r.error ?? r.sheetNote ?? ''}>
        {r.status === 'FAILED' ? <span className="text-rose-600">{r.error}</span> : <><FileSpreadsheet className="mr-1 inline h-3 w-3 text-emerald-600" />{r.sheetNote}</>}
      </p>
      {r.undoneAt ? (
        <span className="text-[10.5px] text-rose-500">Undone {timeAgo(r.undoneAt)} by {r.undoneBy}</span>
      ) : isAdmin && r.applied + r.updated > 0 && (
        <button type="button" onClick={() => onUndo(r)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50">
          <Undo2 className="h-3 w-3" /> Undo run
        </button>
      )}
    </li>
  )
}

export default function VendorSyncLogPage() {
  const [data, setData] = useState<LogPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [page, setPage] = useState(1)
  const [runPage, setRunPage] = useState(1)
  const [action, setAction] = useState<string>('')
  const [ref, setRef] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [showQuiet, setShowQuiet] = useState(false)
  const [cfg, setCfg] = useState<VendorSyncConfig | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ page: String(page), runPage: String(runPage) })
    if (action) sp.set('action', action)
    if (ref.trim()) sp.set('ref', ref.trim())
    if (runId) sp.set('runId', runId)
    if (showQuiet) sp.set('quiet', '1')
    try {
      const res = await fetch(`/api/vn-vendor-sync/logs?${sp}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.success) { setData(json.data); setCfg(c => c ?? json.data.config ?? null) }
      else toast.error(json.error)
    } finally { setLoading(false) }
  }, [page, runPage, action, ref, runId, showQuiet])

  useEffect(() => { const t = setTimeout(() => { void load() }, ref ? 300 : 0); return () => clearTimeout(t) }, [load, ref])
  useEffect(() => { const t = setInterval(() => { void load() }, 60_000); return () => clearInterval(t) }, [load])

  async function runAll() {
    setRunning(true)
    const t = toast.loading('Reading the Excel and matching every upcoming VN movement…')
    try {
      const res = await fetch('/api/vn-vendor-sync/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'runAll' }) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const r = json.data.run as VendorSyncRunInfo
      toast.success(`${r.applied} applied · ${r.updated} updated · ${r.suggested} to review · ${r.keptManual} kept as set by hand`, { id: t, description: r.sheetNote ?? undefined })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed', { id: t })
    } finally { setRunning(false) }
  }

  async function undoRun(r: VendorSyncRunInfo) {
    if (!window.confirm(`Undo every tour vendor this run wrote (${r.applied + r.updated})? Movements changed by a person since are left alone.`)) return
    const res = await fetch('/api/vn-vendor-sync/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'undoRun', runId: r.id }) })
    const json = await res.json()
    if (json.success) toast.success(json.data.message)
    else toast.error(json.error)
    await load()
  }

  async function saveCfg() {
    if (!cfg) return
    setSaving(true)
    try {
      const res = await fetch('/api/vn-vendor-sync/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setCfg(json.data)
      toast.success('Saved')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(false) }
  }

  const totals = data?.totals ?? {}
  const sumTotals = Object.values(totals).reduce((a, b) => a + b, 0)
  const lastRun = data?.runs.find(r => r.scope === 'ALL')

  return (
    <>
      <Header title="VN Vendor Sync" subtitle="Tour vendors on every Vietnam movement, from the desk's Excel checklist — every 15 minutes" />
      <div className="space-y-5 px-4 py-5 sm:px-8 sm:py-6">

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-teal-900 p-5 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-teal-500/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><Store className="h-5 w-5 text-teal-200" /></span>
            <div>
              <p className="text-base font-semibold">Excel VENDORS column → movement Tour Vendor</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/60">
                <Clock className="h-3 w-3" /> Last sweep {timeAgo(lastRun?.startedAt)}
                {lastRun?.sheetNote && <><span className="text-white/30">·</span>{lastRun.sheetNote}</>}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/dashboard/checklist-vn/sheet" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium ring-1 ring-white/20 hover:bg-white/20">
                <FileSpreadsheet className="h-3.5 w-3.5" /> Checklist board
              </Link>
              <Link href="/dashboard/checklist-vn/vendor-sync/register" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium ring-1 ring-white/20 hover:bg-white/20">
                <Store className="h-3.5 w-3.5" /> Vendor register
              </Link>
              {data?.canEdit && data.installed && (
                <button type="button" onClick={runAll} disabled={running}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-400 px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-teal-300 disabled:opacity-60">
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync all now
                </button>
              )}
            </div>
          </div>
          {sumTotals > 0 && (
            <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {(['APPLIED', 'IN_SYNC', 'SUGGESTED', 'KEPT_MANUAL', 'STALE', 'IGNORED'] as LinkStatus[]).map(s => (
                <div key={s} className="rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10" title={LINK_STATUS[s].hint}>
                  <p className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-white/50"><span className={cn('h-1.5 w-1.5 rounded-full', LINK_STATUS[s].dot)} />{LINK_STATUS[s].label}</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums">{totals[s] ?? 0}</p>
                </div>
              ))}
            </div>
          )}
          <p className="relative mt-3 flex items-center gap-1.5 text-[11px] text-white/50">
            <ShieldCheck className="h-3.5 w-3.5 text-teal-300" />
            Writes only the Tour Vendor, only on today-onwards movements, only when empty or still holding its own earlier value. Drivers, rates and anything set by hand are never changed. The Excel is only read.
          </p>
        </div>

        {data && !data.installed && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Database className="mt-0.5 h-4 w-4 shrink-0" />
            Not set up on this database yet. Run <code className="rounded bg-amber-100 px-1">bash prisma/sql/apply-vn-vendor-sync.sh</code> — it creates three new tables and changes nothing else.
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          {/* Runs */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Sweeps</h2>
              <label className="ml-3 mr-auto inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400" title="Runs started by opening a booking that changed nothing">
                <input type="checkbox" checked={showQuiet} onChange={e => { setShowQuiet(e.target.checked); setRunPage(1) }} className="h-3 w-3 rounded border-slate-300" />
                Show quiet runs
              </label>
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <button type="button" disabled={runPage <= 1} onClick={() => setRunPage(p => p - 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                {runPage}
                <button type="button" disabled={(data?.runs.length ?? 0) < 15} onClick={() => setRunPage(p => p + 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
            ) : (data?.runs.length ?? 0) === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-400">No sweeps yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data!.runs.map(r => (
                  <RunRow key={r.id} r={r} isAdmin={data!.isAdmin} onUndo={undoRun} picked={runId === r.id}
                    onPick={id => { setRunId(cur => (cur === id ? null : id)); setPage(1) }} />
                ))}
              </ul>
            )}
          </section>

          {/* Settings */}
          <section className="h-fit rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Settings2 className="h-4 w-4 text-slate-400" />Settings</h2>
            {cfg && (
              <div className="mt-3 space-y-3 text-xs">
                <div>
                  <p className="mb-1 font-medium text-slate-600">Mode</p>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                    {(['AUTO', 'SUGGEST', 'OFF'] as const).map(m => (
                      <button key={m} type="button" disabled={!data?.isAdmin} onClick={() => setCfg({ ...cfg, mode: m })}
                        className={cn('rounded-md py-1.5 font-semibold transition', cfg.mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                        {m === 'AUTO' ? 'Auto' : m === 'SUGGEST' ? 'Suggest' : 'Off'}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10.5px] text-slate-400">
                    {cfg.mode === 'AUTO' ? 'Sure matches are written; the rest wait for a person.' : cfg.mode === 'SUGGEST' ? 'Nothing is written — every match waits for a person.' : 'No sweeps. "Fetch now" still shows matches without writing.'}
                  </p>
                </div>
                <label className="block">
                  <span className="font-medium text-slate-600">Every (minutes)</span>
                  <input type="number" min={5} max={240} disabled={!data?.isAdmin} value={cfg.intervalMin}
                    onChange={e => setCfg({ ...cfg, intervalMin: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5" />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-600">Look ahead (days)</span>
                  <input type="number" min={1} max={400} disabled={!data?.isAdmin} value={cfg.daysAhead}
                    onChange={e => setCfg({ ...cfg, daysAhead: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5" />
                </label>
                {data?.isAdmin ? (
                  <button type="button" onClick={saveCfg} disabled={saving}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save
                  </button>
                ) : <p className="text-[10.5px] text-slate-400">Only admins can change these.</p>}
              </div>
            )}
          </section>
        </div>

        {/* Excel ⇄ System, per movement */}
        {data?.installed && <VendorCompareBoard runId={runId} onChanged={() => { void load() }} />}

        {/* Events */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="mr-2 text-sm font-semibold text-slate-800">Log</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={ref} onChange={e => { setRef(e.target.value); setPage(1) }} placeholder="Booking ref"
                className="w-36 rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs" />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <FilterIcon className="h-3.5 w-3.5 text-slate-300" />
              <button type="button" onClick={() => { setAction(''); setPage(1) }} className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', !action ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>All</button>
              {ACTIONS.map(a => (
                <button key={a} type="button" onClick={() => { setAction(a); setPage(1) }}
                  className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', action === a ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                  {EVENT_ACTION[a].label}
                </button>
              ))}
            </div>
            {runId && (
              <button type="button" onClick={() => setRunId(null)} className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-700 ring-1 ring-teal-200">
                One sweep only ✕
              </button>
            )}
            <span className="ml-auto text-[11px] text-slate-400">{data?.total ?? 0} entries</span>
          </div>
          {(data?.events.length ?? 0) === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-400">{loading ? 'Loading…' : 'Nothing logged for this filter.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                  <tr><th className="px-4 py-2">When</th><th className="px-2 py-2">Booking</th><th className="px-2 py-2">Action</th><th className="px-2 py-2">Movement</th><th className="px-2 py-2">Tour vendor</th><th className="px-2 py-2">Why</th><th className="px-4 py-2">By</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data!.events.map(e => (
                    <tr key={e.id} className="align-top hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500" title={new Date(e.createdAt).toLocaleString('en-GB')}>{timeAgo(e.createdAt)}</td>
                      <td className="px-2 py-2"><Link href={`/dashboard/bookings/${e.bookingRef}/agenda`} className="font-mono font-semibold text-teal-700 hover:underline">{e.bookingRef}</Link></td>
                      <td className="px-2 py-2"><span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', EVENT_ACTION[e.action]?.tone)}>{EVENT_ACTION[e.action]?.label ?? e.action}</span></td>
                      <td className="max-w-[280px] px-2 py-2 text-slate-700">{e.movementLabel}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <span className={cn('text-slate-400', !e.fromValue && 'italic')}>{e.fromValue ?? 'empty'}</span>
                        <ArrowRight className="mx-1 inline h-3 w-3 text-slate-300" />
                        <span className={cn('font-semibold text-slate-800', !e.toValue && 'italic font-normal text-slate-400')}>{e.toValue ?? 'empty'}</span>
                        {e.score !== null && <span className="ml-1.5 text-[10px] tabular-nums text-slate-400">{Math.round(e.score * 100)}%</span>}
                      </td>
                      <td className="max-w-[360px] px-2 py-2 text-[11px] text-slate-500">{e.detail}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">{e.actor ?? 'Auto sync'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(data?.total ?? 0) > 40 && (
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              Page {page} of {Math.ceil((data?.total ?? 0) / 40)}
              <button type="button" disabled={page * 40 >= (data?.total ?? 0)} onClick={() => setPage(p => p + 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
        </section>

        {data?.runs.some(r => r.status === 'FAILED') && (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />A failed sweep retries after 5 minutes. When the Excel cannot be read, the sweep still runs on the last good copy.</p>
        )}
      </div>
    </>
  )
}
