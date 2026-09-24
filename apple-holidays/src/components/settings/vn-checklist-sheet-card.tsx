'use client'

/**
 * Settings → Checklist VN 2.1v.
 *
 * The desk's Excel checklist that OPS mirrors every few hours. Change the link
 * here and the next sync reads the new file; the workbook itself is only ever
 * downloaded, never edited. Both downloads live here too: the original file
 * exactly as it is on SharePoint, and what OPS has stored.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  FileSpreadsheet, Loader2, RefreshCw, Save, ExternalLink, Download, Database, CheckCircle2,
  AlertTriangle, Clock, MinusCircle, ShieldCheck, LayoutGrid,
} from 'lucide-react'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { DEFAULT_CHECKLIST_SHEET_URL, timeAgo, type SheetSyncInfo } from '@/lib/vn-checklist-sheet/shared'

interface Snapshot {
  config: { sheetUrl: string; tabs: string[]; enabled: boolean; intervalHours: number; isDefaultUrl: boolean }
  installed: boolean
  runs: SheetSyncInfo[]
  counts: { tours: number; active: number; lines: number }
  lastSuccessAt: string | null
  nextDueAt: string | null
  file: { fileName: string; webUrl: string; modifiedAt: string | null } | null
  canAdmin: boolean
}

const STATUS_STYLE: Record<string, { icon: typeof CheckCircle2; tone: string; label: string }> = {
  SUCCESS:   { icon: CheckCircle2,  tone: 'text-emerald-600 bg-emerald-50 ring-emerald-200', label: 'Synced' },
  UNCHANGED: { icon: MinusCircle,   tone: 'text-slate-500 bg-slate-50 ring-slate-200',       label: 'No change' },
  RUNNING:   { icon: Loader2,       tone: 'text-sky-600 bg-sky-50 ring-sky-200',             label: 'Running' },
  FAILED:    { icon: AlertTriangle, tone: 'text-rose-600 bg-rose-50 ring-rose-200',          label: 'Failed' },
}

export default function VnChecklistSheetCard() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [form, setForm] = useState({ sheetUrl: '', tabs: '', intervalHours: '2', enabled: true })
  const [busy, setBusy] = useState<null | 'load' | 'save' | 'sync'>('load')

  const apply = useCallback((d: Snapshot) => {
    setSnap(d)
    setForm({ sheetUrl: d.config.sheetUrl, tabs: d.config.tabs.join(', '), intervalHours: String(d.config.intervalHours), enabled: d.config.enabled })
  }, [])

  const reload = useCallback(() => fetch('/api/vn-checklist-sheet/settings', { cache: 'no-store' })
    .then(r => r.json())
    .then(j => { if (j.success) apply(j.data); else toast.error(j.error) })
    .catch(() => toast.error('Could not load Checklist VN 2.1 settings')), [apply])

  useEffect(() => { reload().finally(() => setBusy(null)) }, [reload])

  // Keep the run list moving while a sync is in progress.
  useEffect(() => {
    if (!snap?.runs[0] || snap.runs[0].status !== 'RUNNING') return
    const t = setTimeout(() => { void reload() }, 8000)
    return () => clearTimeout(t)
  }, [snap, reload])

  async function save() {
    setBusy('save')
    try {
      const res = await fetch('/api/vn-checklist-sheet/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, intervalHours: Number(form.intervalHours) }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      apply(json.data)
      toast.success(json.message)
      setTimeout(() => { void reload() }, 4000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setBusy(null) }
  }

  async function sync(force = false) {
    setBusy('sync')
    try {
      const res = await fetch('/api/vn-checklist-sheet/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync', force }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      apply(json.data)
      toast.success(json.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
      void reload()
    } finally { setBusy(null) }
  }

  const last = snap?.runs[0]
  const dirty = snap && (
    form.sheetUrl !== snap.config.sheetUrl || form.tabs !== snap.config.tabs.join(', ')
    || Number(form.intervalHours) !== snap.config.intervalHours || form.enabled !== snap.config.enabled
  )

  return (
    <Card>
      <CardHeader action={
        <Link href="/dashboard/checklist-vn/sheet" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
          <LayoutGrid className="h-3.5 w-3.5" /> Open board
        </Link>
      }>
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-900">Checklist VN 2.1v — Excel sync</h3>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          The VN desk&apos;s live checklist workbook, mirrored into OPS. Shown at the foot of every Vietnam booking page.
        </p>
      </CardHeader>
      <CardBody className="space-y-5">
        {busy === 'load' && !snap ? (
          <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : snap && (
          <>
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-800 ring-1 ring-emerald-100">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Read-only towards the workbook: OPS downloads the file and never opens it for editing, so nothing the desk types can be changed from here.
            </div>

            {!snap.installed && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The mirror tables do not exist on this database yet — run <code className="rounded bg-white px-1">bash prisma/sql/apply-vn-checklist-sheet.sh</code>, then press Sync.
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Tours', snap.counts.active.toLocaleString(), snap.counts.tours > snap.counts.active ? `${snap.counts.tours - snap.counts.active} removed` : 'on the sheet'],
                ['Payment lines', snap.counts.lines.toLocaleString(), 'stored'],
                ['Last good sync', timeAgo(snap.lastSuccessAt), last?.status === 'FAILED' ? 'latest attempt failed' : `every ${snap.config.intervalHours} h`],
                ['Next sync', snap.nextDueAt ? (new Date(snap.nextDueAt) < new Date() ? 'due now' : new Date(snap.nextDueAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) : snap.config.enabled ? 'on first sync' : 'paused', snap.file?.modifiedAt ? `file edited ${timeAgo(snap.file.modifiedAt)}` : ''],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  <p className="text-base font-bold tabular-nums text-slate-900">{value}</p>
                  <p className="truncate text-[10px] text-slate-400">{sub}</p>
                </div>
              ))}
            </div>

            {/* Link */}
            <div className="space-y-3">
              <div>
                <label className="form-label">Excel file link (SharePoint / OneDrive share link)</label>
                <div className="flex gap-2">
                  <input className="form-input flex-1 font-mono text-xs" value={form.sheetUrl} disabled={!snap.canAdmin}
                    onChange={e => setForm(f => ({ ...f, sheetUrl: e.target.value }))} placeholder={DEFAULT_CHECKLIST_SHEET_URL} />
                  {snap.file && (
                    <a href={snap.file.webUrl} target="_blank" rel="noreferrer" className="btn btn-secondary text-xs" title="Open in Excel">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {snap.file ? <>Resolves to <span className="font-medium text-slate-600">{snap.file.fileName}</span></> : <span className="text-rose-500">The link could not be reached with the Graph account.</span>}
                  {snap.config.isDefaultUrl && ' · default link'}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="form-label">Tabs to read</label>
                  <input className="form-input text-xs" value={form.tabs} disabled={!snap.canAdmin}
                    onChange={e => setForm(f => ({ ...f, tabs: e.target.value }))} placeholder='Blank = every "Checklist YYYY" tab' />
                </div>
                <div>
                  <label className="form-label">Sync every (hours)</label>
                  <input type="number" min={0.5} max={24} step={0.5} className="form-input text-xs" value={form.intervalHours} disabled={!snap.canAdmin}
                    onChange={e => setForm(f => ({ ...f, intervalHours: e.target.value }))} />
                </div>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={form.enabled} disabled={!snap.canAdmin} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
                Automatic sync on
              </label>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {snap.canAdmin && (
                <button onClick={save} disabled={!dirty || busy !== null} className="btn btn-primary text-xs">
                  {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                </button>
              )}
              <button onClick={() => sync(false)} disabled={busy !== null || !snap.installed} className="btn btn-secondary text-xs">
                <RefreshCw className={cn('h-3.5 w-3.5', busy === 'sync' && 'animate-spin')} /> Sync now
              </button>
              {snap.canAdmin && (
                <button onClick={() => sync(true)} disabled={busy !== null || !snap.installed} className="btn btn-ghost text-xs" title="Re-read the whole file even if it has not changed">
                  Full re-read
                </button>
              )}
              <span className="flex-1" />
              <a href="/api/vn-checklist-sheet/download?kind=original" className="btn btn-secondary text-xs">
                <Download className="h-3.5 w-3.5" /> Download Excel (original)
              </a>
              {snap.installed && (
                <a href="/api/vn-checklist-sheet/download?kind=mirror" className="btn btn-ghost text-xs">
                  <Download className="h-3.5 w-3.5" /> OPS copy (.xlsx)
                </a>
              )}
            </div>

            {/* Runs */}
            {snap.runs.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent syncs</p>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {snap.runs.map(r => {
                    const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.FAILED
                    const Icon = s.icon
                    return (
                      <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', s.tone)}>
                          <Icon className={cn('h-3 w-3', r.status === 'RUNNING' && 'animate-spin')} /> {s.label}
                        </span>
                        <span className="text-slate-600">{new Date(r.startedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">{r.trigger}{r.triggeredBy ? ` · ${r.triggeredBy}` : ''}</span>
                        {r.status === 'SUCCESS' && (
                          <span className="text-slate-500">{r.tours.toLocaleString()} tours · <b className="text-emerald-600">+{r.added}</b> · <b className="text-indigo-600">~{r.changed}</b> · <b className="text-rose-500">−{r.removed}</b></span>
                        )}
                        {r.durationMs !== null && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400"><Clock className="h-3 w-3" />{(r.durationMs / 1000).toFixed(1)} s</span>}
                        {r.error && <p className="w-full truncate text-[11px] text-rose-600" title={r.error}>{r.error}</p>}
                        {r.warnings && r.status === 'SUCCESS' && <p className="w-full truncate text-[11px] text-amber-600" title={r.warnings}>{r.warnings.split('\n')[0]}</p>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
