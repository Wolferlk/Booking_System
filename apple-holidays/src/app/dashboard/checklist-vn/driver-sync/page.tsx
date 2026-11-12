'use client'

/**
 * VN Driver Sync — the VN team's Movement Chart Google Sheet → each movement's driver.
 * Sweeps, every movement the sync has an opinion on (with Apply / Ignore / Undo),
 * sheet rows it could not place, the log and the settings.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  RefreshCw, Loader2, Car, FileSpreadsheet, ArrowRight, Undo2, Search, Settings2, Database, CheckCircle2, AlertTriangle,
  Clock, ShieldCheck, ChevronLeft, ChevronRight, ExternalLink, Sparkles, Ban, RotateCcw, Check, Phone, Store, Eye,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { cn } from '@/lib/utils'
import { guestDriver } from '@/lib/guest-driver'
import {
  EVENT_ACTION, LINK_STATUS, timeAgo,
  type DriverSyncConfig, type DriverSyncLinkInfo, type DriverSyncOverview, type DriverSyncRunInfo, type LinkStatus,
} from '@/lib/vn-driver-sync/shared'

const STATUSES: LinkStatus[] = ['APPLIED', 'IN_SYNC', 'SUGGESTED', 'KEPT_MANUAL', 'NO_NUMBER', 'STALE', 'IGNORED']
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed')
  return json.data
}
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', weekday: 'short', timeZone: 'UTC' }) : '—')

function RunRow({ r, isAdmin, picked, onPick, onUndo }: { r: DriverSyncRunInfo; isAdmin: boolean; picked: boolean; onPick: () => void; onUndo: () => void }) {
  const tone = r.status === 'FAILED' ? 'bg-rose-500' : r.status === 'RUNNING' ? 'bg-sky-400 animate-pulse' : r.applied + r.updated > 0 ? 'bg-emerald-500' : 'bg-slate-300'
  return (
    <li className={cn('flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs transition hover:bg-slate-50', picked && 'bg-indigo-50/60')}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', tone)} />
      <button type="button" onClick={onPick} className="min-w-[140px] text-left">
        <p className="font-semibold text-slate-800">{new Date(r.startedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
        <p className="text-[10.5px] text-slate-400">
          {r.trigger === 'CRON' ? 'Every 15 min' : r.trigger === 'MANUAL' ? `Sync now · ${r.triggeredBy ?? ''}` : 'On open'}
          {r.scope !== 'ALL' && ` · ${r.scope}`}{r.durationMs !== null && ` · ${(r.durationMs / 1000).toFixed(1)} s`}
        </p>
      </button>
      <div className="flex flex-wrap gap-1.5">
        {r.applied > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">{r.applied} applied</span>}
        {r.updated > 0 && <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700 ring-1 ring-sky-200">{r.updated} updated</span>}
        {r.suggested > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">{r.suggested} to review</span>}
        {r.keptManual > 0 && <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700 ring-1 ring-violet-200">{r.keptManual} kept</span>}
        {r.aiCalls > 0 && <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200"><Sparkles className="mr-0.5 inline h-3 w-3" />{r.aiCalls} AI</span>}
        {r.status !== 'FAILED' && <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-500 ring-1 ring-slate-200">{r.sheetRows} sheet rows · {r.bookings} bookings · {r.matched} matched</span>}
      </div>
      <p className="min-w-0 flex-1 truncate text-[10.5px] text-slate-400" title={r.error ?? r.sheetNote ?? ''}>
        {r.status === 'FAILED' ? <span className="text-rose-600">{r.error}</span> : <><FileSpreadsheet className="mr-1 inline h-3 w-3 text-emerald-600" />{r.sheetNote}</>}
      </p>
      {r.undoneAt ? (
        <span className="text-[10.5px] text-rose-500">Undone {timeAgo(r.undoneAt)} by {r.undoneBy}</span>
      ) : isAdmin && r.applied + r.updated > 0 && (
        <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50"><Undo2 className="h-3 w-3" /> Undo run</button>
      )}
    </li>
  )
}

function LinkRow({ l, canEdit, busy, onAct }: { l: DriverSyncLinkInfo; canEdit: boolean; busy: boolean; onAct: (l: DriverSyncLinkInfo, action: string) => void }) {
  const s = LINK_STATUS[l.status]
  const guest = guestDriver(l.sheet.text, l.phones)
  const ownedBySync = l.status === 'APPLIED'
  return (
    <tr className="align-top hover:bg-slate-50/70">
      <td className="whitespace-nowrap px-4 py-2.5">
        <Link href={`/dashboard/bookings/${l.bookingRef}/agenda`} className="font-mono text-[12px] font-semibold text-indigo-700 hover:underline">{l.bookingRef}</Link>
        <p className="text-[10.5px] text-slate-500">{fmtDate(l.movementDate)}</p>
      </td>
      <td className="max-w-[260px] px-2 py-2.5">
        <p className="text-[11.5px] font-medium text-slate-800">{l.movementLabel?.replace(/^\d{4}-\d{2}-\d{2} · /, '')}</p>
        {l.movementText && <p className="mt-0.5 line-clamp-2 text-[10.5px] text-slate-400" title={l.movementText}>{l.movementText}</p>}
      </td>
      <td className="max-w-[260px] px-2 py-2.5">
        {l.sheet.row ? (
          <>
            <p className="text-[10.5px] text-slate-400">{l.sheet.tab} · row {l.sheet.row}{l.sheet.date && l.sheet.date !== l.movementDate ? <span className="ml-1 text-amber-600">({fmtDate(l.sheet.date)})</span> : null}</p>
            <p className="line-clamp-2 text-[11px] text-slate-600" title={l.sheet.details ?? ''}>{l.sheet.details}</p>
            <p className="text-[10.5px] text-slate-400">{[l.sheet.time, l.sheet.service].filter(Boolean).join(' · ')}</p>
          </>
        ) : <span className="text-[11px] italic text-slate-300">no sheet row</span>}
      </td>
      <td className="max-w-[280px] px-2 py-2.5">
        {l.sheet.text ? <p className="text-[11.5px] font-medium text-slate-800">{l.sheet.text}</p> : <span className="text-[11px] italic text-slate-300">empty</span>}
        {l.phones && (
          <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] text-emerald-700 ring-1 ring-emerald-200" title="What guests and agents are sent">
            <Eye className="h-3 w-3" /> Guests see: <span className="font-semibold">{guest.name}</span>
          </p>
        )}
      </td>
      <td className="max-w-[220px] px-2 py-2.5 text-[11px]">
        {l.now.driverName ? (
          <>
            <p className={cn('font-medium', ownedBySync || l.status === 'IN_SYNC' ? 'text-slate-800' : 'text-violet-700')}>{l.now.driverName}</p>
            {l.now.driverPhone && l.now.driverPhone !== guest.name && <p className="text-[10.5px] text-slate-400"><Phone className="mr-0.5 inline h-3 w-3" />{l.now.driverPhone}</p>}
            {l.now.fromDirectory && <p className="text-[10px] text-violet-500">from the driver directory</p>}
          </>
        ) : <span className="italic text-slate-300">no driver</span>}
      </td>
      <td className="whitespace-nowrap px-2 py-2.5">
        {l.confidence && (
          <span title={l.reason ?? ''} className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1',
            l.confidence === 'HIGH' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200')}>
            {l.method === 'AI' && <Sparkles className="h-3 w-3" />}{l.confidence === 'HIGH' ? 'Sure' : 'Likely'} {l.score !== null && `${Math.round(l.score * 100)}%`}
          </span>
        )}
        <p className="mt-1 max-w-[180px] whitespace-normal text-[10px] leading-snug text-slate-400">{l.reason}</p>
      </td>
      <td className="px-2 py-2.5">
        <span title={s.hint} className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', s.tone)}>{s.label}</span>
        {l.note && <p className="mt-1 max-w-[180px] text-[10px] leading-snug text-slate-400">{l.note}</p>}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right">
        {canEdit && (
          <div className="flex justify-end gap-1">
            {(l.status === 'SUGGESTED' || (l.status === 'KEPT_MANUAL' && !l.now.fromDirectory)) && l.phones && (
              <button type="button" disabled={busy} onClick={() => onAct(l, 'apply')}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                <Check className="h-3 w-3" />{l.status === 'KEPT_MANUAL' ? 'Replace' : 'Apply'}
              </button>
            )}
            {l.status === 'APPLIED' && (
              <button type="button" disabled={busy} onClick={() => onAct(l, 'undo')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                <Undo2 className="h-3 w-3" />Undo
              </button>
            )}
            {l.status === 'IGNORED' ? (
              <button type="button" disabled={busy} onClick={() => onAct(l, 'restore')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                <RotateCcw className="h-3 w-3" />Review again
              </button>
            ) : l.status !== 'APPLIED' && l.status !== 'IN_SYNC' && (
              <button type="button" disabled={busy} onClick={() => onAct(l, 'ignore')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                <Ban className="h-3 w-3" />Ignore
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

export default function DriverSyncPage() {
  const [data, setData] = useState<DriverSyncOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [status, setStatus] = useState<LinkStatus | ''>('SUGGESTED')
  const [ref, setRef] = useState('')
  const [page, setPage] = useState(1)
  const [runId, setRunId] = useState<string | null>(null)
  const [cfg, setCfg] = useState<DriverSyncConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'movements' | 'unmatched' | 'log'>('movements')

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ page: String(page) })
    if (status) sp.set('status', status)
    if (ref.trim()) sp.set('ref', ref.trim())
    if (runId) sp.set('runId', runId)
    try {
      const res = await fetch(`/api/vn-driver-sync?${sp}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.success) { setData(json.data); setCfg(c => c ?? json.data.config) }
      else toast.error(json.error)
    } finally { setLoading(false) }
  }, [page, status, ref, runId])

  useEffect(() => { const t = setTimeout(() => { void load() }, ref ? 300 : 0); return () => clearTimeout(t) }, [load, ref])
  useEffect(() => { const t = setInterval(() => { void load() }, 60_000); return () => clearInterval(t) }, [load])

  async function runAll() {
    setRunning(true)
    const t = toast.loading('Reading the Movement Chart and matching every upcoming VN movement…')
    try {
      const { run } = await post('/api/vn-driver-sync/action', { action: 'runAll' }) as { run: DriverSyncRunInfo }
      toast.success(`${run.applied} applied · ${run.updated} updated · ${run.suggested} to review · ${run.keptManual} kept`, { id: t, description: run.sheetNote ?? undefined })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed', { id: t, duration: 12_000 })
      await load()
    } finally { setRunning(false) }
  }

  async function act(l: DriverSyncLinkInfo, action: string) {
    if (action === 'apply' && l.status === 'KEPT_MANUAL'
      && !window.confirm(`Replace "${l.now.driverName}" with the sheet's driver?\n\n${l.sheet.text}`)) return
    setBusyId(l.id)
    try {
      const { message } = await post('/api/vn-driver-sync/action', { action, linkId: l.id }) as { message: string }
      toast.success(message)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally { setBusyId(null) }
  }

  async function undoRun(r: DriverSyncRunInfo) {
    if (!window.confirm(`Undo every driver this run wrote (${r.applied + r.updated})? Movements changed by a person since are left alone.`)) return
    try {
      const { message } = await post('/api/vn-driver-sync/action', { action: 'undoRun', runId: r.id }) as { message: string }
      toast.success(message)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
    await load()
  }

  async function saveCfg() {
    if (!cfg) return
    setSaving(true)
    try {
      setCfg(await post('/api/vn-driver-sync/settings', cfg))
      toast.success('Saved')
      await load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save') } finally { setSaving(false) }
  }

  const totals = data?.totals ?? {}
  const lastRun = data?.runs.find(r => r.scope === 'ALL')
  const lastGood = data?.runs.find(r => r.scope === 'ALL' && r.status === 'SUCCESS')
  const accessProblem = lastRun?.status === 'FAILED' && /private|shared|share|sign-in|401|403/i.test(lastRun.error ?? '')

  return (
    <>
      <Header title="VN Driver Sync" subtitle="Drivers on every Vietnam movement, from the VN team's Movement Chart Google Sheet — every 15 minutes" />
      <div className="space-y-5 px-4 py-5 sm:px-8 sm:py-6">

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-900 p-5 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-indigo-500/25 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><Car className="h-5 w-5 text-indigo-200" /></span>
            <div className="min-w-0">
              <p className="text-base font-semibold">Movement Chart <span className="text-white/50">Vendors</span> → movement Driver</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-white/60">
                <Clock className="h-3 w-3" /> Last sweep {timeAgo(lastRun?.startedAt)}
                {data?.sheet && <><span className="text-white/30">·</span>Sheet read {timeAgo(data.sheet.at)} ({data.sheet.rows} rows{data.sheet.title ? ` · ${data.sheet.title}` : ''})</>}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {data?.access.sheetUrl && (
                <a href={data.access.sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium ring-1 ring-white/20 hover:bg-white/20">
                  <ExternalLink className="h-3.5 w-3.5" /> Open sheet
                </a>
              )}
              <Link href="/dashboard/checklist-vn/vendor-sync" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium ring-1 ring-white/20 hover:bg-white/20">
                <Store className="h-3.5 w-3.5" /> Vendor sync
              </Link>
              {data?.canEdit && data.installed && (
                <button type="button" onClick={runAll} disabled={running}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-400 px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-indigo-300 disabled:opacity-60">
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync all now
                </button>
              )}
            </div>
          </div>
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {STATUSES.map(s => (
              <button key={s} type="button" onClick={() => { setStatus(cur => (cur === s ? '' : s)); setPage(1); setTab('movements') }} title={LINK_STATUS[s].hint}
                className={cn('rounded-xl px-3 py-2 text-left ring-1 transition', status === s ? 'bg-white/15 ring-white/40' : 'bg-white/[0.06] ring-white/10 hover:bg-white/10')}>
                <p className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-white/50"><span className={cn('h-1.5 w-1.5 rounded-full', LINK_STATUS[s].dot)} />{LINK_STATUS[s].label}</p>
                <p className="mt-0.5 text-xl font-bold tabular-nums">{totals[s] ?? 0}</p>
              </button>
            ))}
          </div>
          <p className="relative mt-3 flex items-start gap-1.5 text-[11px] text-white/50">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-indigo-300" />
            Writes only the driver text and its numbers, only on today-onwards movements, only when the movement has no driver or still holds what the sync wrote.
            A driver from the directory or one typed by hand is never replaced, a sheet text without a phone number is never written, and the sheet is only read.
            Guests and agents see the numbers only — never the vendor name.
          </p>
        </div>

        {data && !data.installed && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Database className="mt-0.5 h-4 w-4 shrink-0" />
            Not set up on this database yet. Run <code className="rounded bg-amber-100 px-1">bash prisma/sql/apply-vn-driver-sync.sh</code> — it creates three new tables and changes nothing else.
          </div>
        )}

        {accessProblem && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />The Movement Chart cannot be read</p>
            <p className="mt-1 text-[12.5px]">{lastRun?.error}</p>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[12px] text-rose-700">
              <li>Open the sheet → <b>Share</b> → General access → <b>Anyone with the link</b> → <b>Viewer</b>, then press Sync all now.</li>
              <li>Or keep it private and share it as Viewer with {data?.access.serviceAccount ? <b className="font-mono">{data.access.serviceAccount}</b> : <>a Google service account (set <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> on the server first)</>}.</li>
            </ol>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          {/* Runs */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Sweeps</h2>
              {runId && <button type="button" onClick={() => setRunId(null)} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200">One sweep only ✕</button>}
            </div>
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
            ) : (data?.runs.length ?? 0) === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-400">No sweeps yet{data?.installed ? ' — press Sync all now.' : '.'}</p>
            ) : (
              <ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto">
                {data!.runs.map(r => (
                  <RunRow key={r.id} r={r} isAdmin={data!.isAdmin} picked={runId === r.id}
                    onPick={() => { setRunId(cur => (cur === r.id ? null : r.id)); setStatus(''); setPage(1) }} onUndo={() => undoRun(r)} />
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
                    {cfg.mode === 'AUTO' ? 'Sure matches are written; the rest wait for a person.' : cfg.mode === 'SUGGEST' ? 'Nothing is written — every match waits for a person.' : 'No sweeps. "Sync all now" still shows matches without writing.'}
                  </p>
                </div>
                <label className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
                  <span><span className="flex items-center gap-1 font-medium text-slate-700"><Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />AI for close calls</span>
                    <span className="text-[10.5px] text-slate-400">OpenAI decides only what the rules cannot; cached per booking</span></span>
                  <input type="checkbox" disabled={!data?.isAdmin} checked={cfg.useAi} onChange={e => setCfg({ ...cfg, useAi: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-600">Google Sheet link</span>
                  <input disabled={!data?.isAdmin} value={cfg.sheet} onChange={e => setCfg({ ...cfg, sheet: e.target.value })}
                    className="mt-1 w-full truncate rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-[10.5px]" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="font-medium text-slate-600">Every (min)</span>
                    <input type="number" min={5} max={240} disabled={!data?.isAdmin} value={cfg.intervalMin} onChange={e => setCfg({ ...cfg, intervalMin: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5" />
                  </label>
                  <label className="block">
                    <span className="font-medium text-slate-600">Look ahead (days)</span>
                    <input type="number" min={1} max={400} disabled={!data?.isAdmin} value={cfg.daysAhead} onChange={e => setCfg({ ...cfg, daysAhead: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5" />
                  </label>
                </div>
                <p className="text-[10.5px] text-slate-400">
                  Reading via {data?.access.serviceAccount ? <>service account <span className="font-mono">{data.access.serviceAccount}</span> (falls back to the shared link)</> : 'the sheet\'s shared link'}.
                </p>
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

        {/* Movements / unmatched / log */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            {([['movements', `Movements${data ? ` (${data.linkTotal})` : ''}`], ['unmatched', `Sheet rows not placed${data ? ` (${data.unmatched.length})` : ''}`], ['log', 'Log']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold', tab === k ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>{label}</button>
            ))}
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={ref} onChange={e => { setRef(e.target.value); setPage(1) }} placeholder="Booking ref" className="w-36 rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs" />
            </div>
          </div>

          {tab === 'movements' && (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-4 py-2">
                <button type="button" onClick={() => { setStatus(''); setPage(1) }} className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', !status ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>All</button>
                {STATUSES.map(s => (
                  <button key={s} type="button" onClick={() => { setStatus(s); setPage(1) }}
                    className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', status === s ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                    {LINK_STATUS[s].label} <span className="opacity-60">{totals[s] ?? 0}</span>
                  </button>
                ))}
              </div>
              {(data?.links.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">{loading ? 'Loading…' : 'Nothing here for this filter.'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                      <tr><th className="px-4 py-2">Booking</th><th className="px-2 py-2">System movement</th><th className="px-2 py-2">Sheet row</th><th className="px-2 py-2">Driver from the sheet</th><th className="px-2 py-2">On the movement now</th><th className="px-2 py-2">Match</th><th className="px-2 py-2">Status</th><th className="px-4 py-2" /></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data!.links.map(l => <LinkRow key={l.id} l={l} canEdit={data!.canEdit} busy={busyId === l.id} onAct={act} />)}
                    </tbody>
                  </table>
                </div>
              )}
              {(data?.linkTotal ?? 0) > 50 && (
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                  Page {page} of {Math.ceil((data?.linkTotal ?? 0) / 50)}
                  <button type="button" disabled={page * 50 >= (data?.linkTotal ?? 0)} onClick={() => setPage(p => p + 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
            </>
          )}

          {tab === 'unmatched' && (
            (data?.unmatched.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">{lastGood ? 'Every sheet row with a phone number found its movement.' : 'No successful sweep yet.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <p className="px-4 pt-3 text-[11px] text-slate-400">Sheet rows that carry a phone number but match no upcoming movement in the system — usually a date or booking code that differs between the sheet and the chart.</p>
                <table className="mt-2 w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                    <tr><th className="px-4 py-2">Booking</th><th className="px-2 py-2">Sheet</th><th className="px-2 py-2">Details</th><th className="px-2 py-2">Vendors</th><th className="px-4 py-2">Why</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data!.unmatched.map(u => (
                      <tr key={`${u.tab}-${u.row}-${u.bookingRef}`} className="align-top">
                        <td className="whitespace-nowrap px-4 py-2"><Link href={`/dashboard/bookings/${u.bookingRef}/agenda`} className="font-mono font-semibold text-indigo-700 hover:underline">{u.bookingRef}</Link><p className="text-[10.5px] text-slate-500">{fmtDate(u.date)}</p></td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-500">{u.tab} · row {u.row}<p className="text-[10.5px] text-slate-400">{[u.time, u.service].filter(Boolean).join(' · ')}</p></td>
                        <td className="max-w-[320px] px-2 py-2 text-slate-600">{u.details}</td>
                        <td className="max-w-[280px] px-2 py-2 font-medium text-slate-800">{u.text}</td>
                        <td className="px-4 py-2 text-[11px] text-amber-700">{u.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'log' && (
            (data?.events.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">Nothing logged yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                    <tr><th className="px-4 py-2">When</th><th className="px-2 py-2">Booking</th><th className="px-2 py-2">Action</th><th className="px-2 py-2">Movement</th><th className="px-2 py-2">Driver</th><th className="px-2 py-2">Why</th><th className="px-4 py-2">By</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data!.events.map(e => (
                      <tr key={e.id} className="align-top hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-4 py-2 text-slate-500" title={new Date(e.createdAt).toLocaleString('en-GB')}>{timeAgo(e.createdAt)}</td>
                        <td className="px-2 py-2"><Link href={`/dashboard/bookings/${e.bookingRef}/agenda`} className="font-mono font-semibold text-indigo-700 hover:underline">{e.bookingRef}</Link></td>
                        <td className="px-2 py-2"><span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', EVENT_ACTION[e.action]?.tone)}>{EVENT_ACTION[e.action]?.label ?? e.action}</span></td>
                        <td className="max-w-[240px] px-2 py-2 text-slate-700">{e.movementLabel}</td>
                        <td className="max-w-[320px] px-2 py-2">
                          <span className={cn('text-slate-400', !e.fromValue && 'italic')}>{e.fromValue ?? 'empty'}</span>
                          <ArrowRight className="mx-1 inline h-3 w-3 text-slate-300" />
                          <span className={cn('font-semibold text-slate-800', !e.toValue && 'font-normal italic text-slate-400')}>{e.toValue ?? 'empty'}</span>
                        </td>
                        <td className="max-w-[300px] px-2 py-2 text-[11px] text-slate-500">{e.detail}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-500">{e.actor ?? 'Auto sync'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </section>
      </div>
    </>
  )
}
