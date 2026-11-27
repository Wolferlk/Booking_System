'use client'

/**
 * Settings → MC Excel Feed.
 *
 * Every movement of every booking arriving from the start date, written into
 * one Excel workbook (one row per agenda line, ordered by arrival date) and
 * kept up to date as bookings arrive and charts change. OPS fills its own
 * columns; the desk's columns (Meeting Time, Vendor, Type of Car, QC…) are
 * never written. Preview shows the exact plan before anything is written.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  FileSpreadsheet, Loader2, RefreshCw, Save, ExternalLink, Download, CheckCircle2, AlertTriangle, Clock,
  MinusCircle, ShieldCheck, Eye, Wand2, Plus, PencilLine, Link2, EyeOff, Trash2, Zap, Info, ArrowRight, ListChecks,
  Undo2, GitMerge, Palette,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  BAND_PAIRS, FEED_COLUMNS, FEED_COUNTRIES, timeAgo, type BandPair,
  type FeedConfig, type FeedCountry, type FeedCounts, type FeedRun, type PlanSample,
} from '@/lib/mc-excel-feed/shared'

interface Snapshot {
  config: FeedConfig
  state: { lastRun: FeedRun | null; lastSuccessAt: string | null; progress: { runId: string; phase: string; done: number; total: number; at: string } | null }
  runs: FeedRun[]
  running: boolean
  canAdmin: boolean
}

interface SheetStatus {
  file: { name: string; webUrl: string; lastModified: string | null } | null
  tabExists: boolean
  tabs: string[]
  headerRow: number | null
  header: { missing: string[]; missingOps: string[]; missingRequired: string[]; duplicateHeaders: string[] } | null
  dataRows: number
  layout: boolean
  error: string | null
}

interface Preview {
  run: FeedRun
  sheet: SheetStatus
  samples: PlanSample[]
  plan: { inserts: number; insertBlocks: number; writes: number } | null
}

type FormState = Omit<FeedConfig, 'intervalMin'> & { intervalMin: string }

const RUN_STYLE: Record<FeedRun['status'], { icon: typeof CheckCircle2; tone: string; label: string }> = {
  SUCCESS:   { icon: CheckCircle2,  tone: 'text-emerald-600 bg-emerald-50 ring-emerald-200', label: 'Written' },
  NO_CHANGE: { icon: MinusCircle,   tone: 'text-slate-500 bg-slate-50 ring-slate-200',       label: 'In step' },
  SKIPPED:   { icon: Clock,         tone: 'text-sky-600 bg-sky-50 ring-sky-200',             label: 'Skipped' },
  FAILED:    { icon: AlertTriangle, tone: 'text-rose-600 bg-rose-50 ring-rose-200',          label: 'Failed' },
}

const SAMPLE_KIND: Record<PlanSample['kind'], { label: string; icon: typeof Plus; tone: string }> = {
  add:      { label: 'New rows',            icon: Plus,       tone: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  update:   { label: 'Updated',             icon: PencilLine, tone: 'text-amber-700 bg-amber-50 ring-amber-200' },
  toOps:    { label: 'Excel → OPS',         icon: Undo2,      tone: 'text-violet-700 bg-violet-50 ring-violet-200' },
  conflict: { label: 'Conflicts',           icon: GitMerge,   tone: 'text-orange-700 bg-orange-50 ring-orange-200' },
  rekey:    { label: 'Re-attached',         icon: Link2,      tone: 'text-indigo-700 bg-indigo-50 ring-indigo-200' },
  inactive: { label: 'Flagged',             icon: EyeOff,     tone: 'text-slate-600 bg-slate-100 ring-slate-200' },
  deleted:  { label: 'Deleted in Excel',    icon: Trash2,     tone: 'text-rose-700 bg-rose-50 ring-rose-200' },
}

const KIND_ORDER: PlanSample['kind'][] = ['add', 'update', 'toOps', 'conflict', 'rekey', 'inactive', 'deleted']
const fieldName = (f?: string) => (f === 'meetingTime' ? 'Meeting Time' : f === 'driver' ? 'Driver Details' : '')

const fmtDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00`)
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export default function McExcelFeedCard() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [sheet, setSheet] = useState<SheetStatus | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [tab, setTab] = useState<PlanSample['kind']>('add')
  const [busy, setBusy] = useState<null | 'load' | 'save' | 'check' | 'preview' | 'sync' | 'prepare' | 'restore' | 'settle' | 'bulk'>('load')

  const apply = useCallback((d: Snapshot) => {
    setSnap(d)
    setForm({ ...d.config, intervalMin: String(d.config.intervalMin) })
  }, [])

  const reload = useCallback(() => fetch('/api/mc-excel-feed', { cache: 'no-store' })
    .then(r => r.json())
    .then(j => { if (j.success) { setSnap(j.data); setForm(f => f ?? { ...j.data.config, intervalMin: String(j.data.config.intervalMin) }) } else toast.error(j.error) })
    .catch(() => toast.error('Could not load the MC Excel Feed settings')), [])

  useEffect(() => {
    fetch('/api/mc-excel-feed', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (j.success) apply(j.data); else toast.error(j.error) })
      .catch(() => toast.error('Could not load the MC Excel Feed settings'))
      .finally(() => setBusy(null))
  }, [apply])

  // Follow a running sync (a first fill writes thousands of rows).
  useEffect(() => {
    if (!snap?.running) return
    const t = setTimeout(() => { void reload() }, 4000)
    return () => clearTimeout(t)
  }, [snap, reload])

  async function post(body: Record<string, unknown>) {
    const res = await fetch('/api/mc-excel-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!json.success) throw new Error(json.error || `Failed (${res.status})`)
    return json as { data: Record<string, unknown>; message?: string }
  }

  async function save() {
    if (!form) return
    setBusy('save')
    try {
      const res = await fetch('/api/mc-excel-feed', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, intervalMin: Number(form.intervalMin) }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      apply(json.data)
      setPreview(null)
      toast.success(json.message || 'Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setBusy(null) }
  }

  async function check() {
    setBusy('check')
    try {
      const j = await post({ action: 'check' })
      const s = j.data.sheet as SheetStatus
      setSheet(s)
      if (s.error) toast.error(s.error); else toast.success(`Opened ${s.file?.name}`)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Check failed') } finally { setBusy(null) }
  }

  async function runPreview() {
    setBusy('preview')
    try {
      const j = await post({ action: 'preview' })
      const p = j.data as unknown as Preview
      setPreview(p)
      setSheet(p.sheet)
      const c = p.run.counts
      const first = (['conflict', ...KIND_ORDER] as const).find(k => p.samples.some(s => s.kind === k))
      if (first) setTab(first)
      toast.success(c && (c.added + c.updatedRows + c.markedInactive) ? 'Preview ready — nothing has been written' : 'The workbook already matches OPS')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Preview failed') } finally { setBusy(null) }
  }

  async function sync(restoreDeleted = false, allowBulkWriteBack = false) {
    const c = preview?.run.counts
    const toOps = c && c.toOps ? `\n${c.toOps} Meeting Time / Driver change(s) from the Excel will be written to the OPS agenda (no WhatsApp is sent).` : ''
    const msg = restoreDeleted
      ? `Put back the ${c?.deletedInExcel ?? ''} row(s) the desk deleted from the Excel?`
      : allowBulkWriteBack
        ? `Send ALL ${c?.toOpsWaiting ?? ''} held-back Meeting Time / Driver changes from the Excel to the OPS agenda?\n\nEach is checked against OPS first (compare-and-set) and logged on the booking. No WhatsApp is sent.`
        : c
          ? `Write now?\n\nExcel: +${c.added} new rows · ${c.updatedRows} rows updated · ${c.markedInactive} flagged${toOps}\n\nDesk columns and rows are never touched or deleted.`
          : 'Write now? (Tip: press Preview first to see exactly what will change.)\n\nDesk columns and rows are never touched or deleted.'
    if (!window.confirm(msg)) return
    setBusy(restoreDeleted ? 'restore' : allowBulkWriteBack ? 'bulk' : 'sync')
    try {
      const j = await post({ action: 'sync', restoreDeleted, allowBulkWriteBack })
      setSnap(s => ({ ...(s as Snapshot), ...(j.data as unknown as Snapshot) }))
      setPreview(null)
      toast.success(j.message || 'Synced')
      void reload()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Sync failed'); void reload() } finally { setBusy(null) }
  }

  /** Settle conflicts (keep OPS or Excel); the next sync carries the chosen side across. */
  async function settle(items: PlanSample[], keep: 'ops' | 'excel') {
    if (!items.length) return
    setBusy('settle')
    try {
      const j = await post({
        action: 'settle',
        items: items.map(s => ({ bookingRef: s.bookingRef, sheetLineId: s.sheetLineId, field: s.field, keep, opsKey: s.opsKey, xlKey: s.xlKey })),
      })
      toast.success(j.message || 'Settled')
      setPreview(p => p && {
        ...p,
        samples: p.samples.filter(s => !items.includes(s)),
        run: { ...p.run, counts: p.run.counts && { ...p.run.counts, conflicts: Math.max(0, p.run.counts.conflicts - items.length) } },
      })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not settle') } finally { setBusy(null) }
  }

  async function prepare() {
    if (!window.confirm('Prepare the workbook?\n\n• An EMPTY workbook gets the full layout: header, colours, filters, frozen header, a Lists tab and dropdowns.\n• A workbook that already has data only gets the feed tab / missing header columns — no row or desk cell is changed.')) return
    setBusy('prepare')
    try {
      const j = await post({ action: 'prepare' })
      const p = j.data.prepare as { notes: string[] }
      setSheet(j.data.sheet as SheetStatus)
      toast.success(j.message || 'Prepared', { description: p.notes[0] })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Prepare failed') } finally { setBusy(null) }
  }

  const dirty = useMemo(() => {
    if (!snap || !form) return false
    const a = snap.config
    return a.sheetUrl !== form.sheetUrl || a.tabName !== form.tabName || a.startDate !== form.startDate
      || a.countries.join() !== form.countries.join() || String(a.intervalMin) !== form.intervalMin
      || a.enabled !== form.enabled || a.placement !== form.placement || a.greyInactive !== form.greyInactive
      || a.writeBack !== form.writeBack || a.bandColors !== form.bandColors || a.bandPair !== form.bandPair
  }, [snap, form])

  const last = snap?.runs.find(r => r.trigger !== 'PREVIEW') ?? null
  const progress = snap?.running ? snap.state.progress : null
  const counts: FeedCounts | null = preview?.run.counts ?? null
  const nextAt = snap?.config.enabled && snap.state.lastRun?.at
    ? new Date(Date.parse(snap.state.lastRun.at) + snap.config.intervalMin * 60_000) : null

  return (
    <Card>
      <CardHeader action={
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1',
            snap?.config.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200')}>
            <Zap className={cn('h-3 w-3', snap?.config.enabled && 'fill-emerald-500')} /> {snap?.config.enabled ? `Auto · ${snap.config.intervalMin} min` : 'Auto off'}
          </span>
          {sheet?.file && (
            <a href={sheet.file.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Open Excel
            </a>
          )}
        </div>
      }>
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-900">MC Excel Feed — every movement into Excel</h3>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          One row per agenda line, for every booking arriving from the start date, ordered by arrival date — new bookings and chart changes follow automatically.
        </p>
      </CardHeader>

      <CardBody className="space-y-5">
        {busy === 'load' && !snap ? (
          <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : snap && form && (
          <>
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50/60 px-3 py-2 text-[11px] leading-relaxed text-emerald-900 ring-1 ring-emerald-100">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b className="text-teal-700">Teal</b> columns come from OPS; <b className="text-amber-700">amber</b> desk columns are never written — not even blanked;
                <b className="text-violet-700"> violet</b> Meeting Time and Driver Details go both ways (Excel → OPS only while its switch is on; a change on both sides waits for you).
                Rows are <b>never deleted</b>: a movement removed in OPS is flagged &ldquo;Removed in OPS&rdquo; and greyed, keeping the desk&apos;s notes. A row the desk deletes is not put back.
              </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['On the sheet', last?.counts ? (last.counts.sheetRows + last.counts.added).toLocaleString() : '—', last?.counts ? `${last.counts.feedRows.toLocaleString()} OPS movements` : 'not synced yet'],
                ['Last sync', timeAgo(snap.state.lastSuccessAt), last?.status === 'FAILED' ? 'latest attempt failed' : last ? RUN_STYLE[last.status].label : '—'],
                ['Next sync', !snap.config.enabled ? 'off' : !nextAt ? 'on next tick' : nextAt < new Date() ? 'due now' : nextAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), snap.config.enabled ? `every ${snap.config.intervalMin} min` : 'switch on below'],
                ['From arrival', fmtDay(snap.config.startDate), snap.config.countries.map(c => FEED_COUNTRIES.find(x => x.value === c)?.label).join(', ')],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  <p className="text-base font-bold tabular-nums text-slate-900">{value}</p>
                  <p className="truncate text-[10px] text-slate-400">{sub}</p>
                </div>
              ))}
            </div>

            {progress && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                <div className="mb-1 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress.phase} — {progress.done} / {progress.total} steps</div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sky-100">
                  <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                </div>
              </div>
            )}
            {snap.running && !progress && (
              <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"><Loader2 className="h-3.5 w-3.5 animate-spin" /> A sync is running…</div>
            )}

            {/* Settings */}
            <div className="space-y-3">
              <div>
                <label className="form-label">Excel workbook (SharePoint / OneDrive share link)</label>
                <input className="form-input font-mono text-xs" value={form.sheetUrl} disabled={!snap.canAdmin}
                  onChange={e => setForm(f => f && ({ ...f, sheetUrl: e.target.value }))} placeholder="https://aahaas-my.sharepoint.com/:x:/p/…" />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="form-label">Tab</label>
                  <input className="form-input text-xs" value={form.tabName} maxLength={31} disabled={!snap.canAdmin}
                    onChange={e => setForm(f => f && ({ ...f, tabName: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Bookings arriving from</label>
                  <input type="date" className="form-input text-xs" value={form.startDate} disabled={!snap.canAdmin}
                    onChange={e => setForm(f => f && ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Sync every (minutes)</label>
                  <input type="number" min={5} max={240} className="form-input text-xs" value={form.intervalMin} disabled={!snap.canAdmin}
                    onChange={e => setForm(f => f && ({ ...f, intervalMin: e.target.value }))} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Countries</span>
                {FEED_COUNTRIES.map(c => {
                  const on = form.countries.includes(c.value)
                  return (
                    <button key={c.value} type="button" disabled={!snap.canAdmin}
                      onClick={() => setForm(f => f && ({ ...f, countries: on ? f.countries.filter(x => x !== c.value) : [...f.countries, c.value as FeedCountry] }))}
                      className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition', on ? 'bg-emerald-600 text-white ring-emerald-700' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')}>
                      {c.label}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 font-medium" title="Where a new movement's row goes">
                  {([['sorted', 'Insert by arrival date'], ['append', 'Add at the bottom']] as const).map(([v, l]) => (
                    <button key={v} type="button" disabled={!snap.canAdmin} onClick={() => setForm(f => f && ({ ...f, placement: v }))}
                      className={cn('rounded-md px-2.5 py-1', form.placement === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')}>{l}</button>
                  ))}
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={form.greyInactive} disabled={!snap.canAdmin} onChange={e => setForm(f => f && ({ ...f, greyInactive: e.target.checked }))} />
                  Grey out removed / cancelled rows
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5" title="On a workbook without the OPS layout, OPS paints the two booking colours itself (the layout colours itself)">
                  <input type="checkbox" checked={form.bandColors} disabled={!snap.canAdmin} onChange={e => setForm(f => f && ({ ...f, bandColors: e.target.checked }))} />
                  <Palette className="h-3.5 w-3.5 text-indigo-500" /> Two booking colours
                </label>
                {form.bandColors && (
                  <div className="inline-flex items-center gap-1.5" role="radiogroup" aria-label="Booking colours">
                    {(Object.entries(BAND_PAIRS) as [BandPair, (typeof BAND_PAIRS)[BandPair]][]).map(([k, p]) => (
                      <button key={k} type="button" role="radio" aria-checked={form.bandPair === k} title={p.label} disabled={!snap.canAdmin}
                        onClick={() => setForm(f => f && ({ ...f, bandPair: k }))}
                        className={cn('flex w-10 flex-col overflow-hidden rounded-md ring-1 transition',
                          form.bandPair === k ? 'ring-2 ring-indigo-500 ring-offset-1' : 'ring-slate-300 hover:ring-slate-400')}>
                        {[p.a, p.a, p.b, p.b, p.a].map((c, i) => (
                          <span key={i} className="block h-1.5 border-b border-white/60 last:border-0" style={{ background: c }} />
                        ))}
                      </button>
                    ))}
                    <span className="text-[11px] text-slate-500">{BAND_PAIRS[form.bandPair]?.label}</span>
                  </div>
                )}
                <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-slate-700">
                  <input type="checkbox" checked={form.enabled} disabled={!snap.canAdmin} onChange={e => setForm(f => f && ({ ...f, enabled: e.target.checked }))} />
                  Automatic sync on
                </label>
              </div>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-xs ring-1 transition',
                form.writeBack ? 'bg-violet-50 text-violet-900 ring-violet-200' : 'bg-slate-50 text-slate-600 ring-slate-200')}>
                <input type="checkbox" className="mt-0.5 accent-violet-600" checked={form.writeBack} disabled={!snap.canAdmin}
                  onChange={e => {
                    const on = e.target.checked
                    if (on && !window.confirm('Switch ON Excel → OPS?\n\nMeeting Time and Driver Details typed in the Excel will update the live OPS agenda on each sync:\n• only the side that changed since the last sync wins — a change on both sides is a conflict you settle;\n• every write is checked against OPS first and logged on the booking;\n• a blank cell never clears OPS; no driver on leisure / hotel-only / cancelled movements;\n• no WhatsApp is sent to drivers.')) return
                    setForm(f => f && ({ ...f, writeBack: on }))
                  }} />
                <span>
                  <b className="inline-flex items-center gap-1"><Undo2 className="h-3.5 w-3.5" /> Excel → OPS for Meeting Time and Driver Details</b>
                  <span className="block text-[11px] opacity-80">
                    {form.writeBack
                      ? 'On — desk edits in those two violet columns update the agenda (checked, logged, no WhatsApp).'
                      : 'Off — OPS still fills those columns; desk edits are shown in the preview as waiting and left in the sheet.'}
                  </span>
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {snap.canAdmin && (
                <button onClick={save} disabled={!dirty || busy !== null} className="btn btn-primary text-xs">
                  {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                </button>
              )}
              <button onClick={check} disabled={busy !== null || dirty} className="btn btn-secondary text-xs" title="Read-only: open the workbook and check the tab and header">
                {busy === 'check' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Info className="h-3.5 w-3.5" />} Check workbook
              </button>
              <button onClick={runPreview} disabled={busy !== null || dirty} className="btn btn-secondary text-xs" title="Work out every change — writes nothing">
                {busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Preview changes
              </button>
              {snap.canAdmin && (
                <>
                  <button onClick={() => sync(false)} disabled={busy !== null || dirty || snap.running} className="btn text-xs border border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
                  </button>
                  <button onClick={prepare} disabled={busy !== null || dirty || snap.running} className="btn btn-ghost text-xs" title="Lay out the tab; an empty workbook gets the full layout with dropdowns">
                    {busy === 'prepare' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Prepare sheet
                  </button>
                </>
              )}
              <span className="flex-1" />
              <a href="/api/mc-excel-feed/download?kind=copy" className="btn btn-secondary text-xs" title="Every movement OPS would write, in the same layout — read-only download">
                <Download className="h-3.5 w-3.5" /> OPS copy (.xlsx)
              </a>
              <a href="/api/mc-excel-feed/download?kind=template" className="btn btn-ghost text-xs">
                <Download className="h-3.5 w-3.5" /> Template
              </a>
            </div>
            {dirty && <p className="-mt-3 text-[11px] text-amber-600">Save first — Check, Preview and Sync use the saved settings.</p>}

            {/* Workbook status */}
            {sheet && (
              <div className={cn('rounded-lg border px-3 py-2 text-xs', sheet.error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50/60 text-slate-600')}>
                {sheet.error ? (
                  <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{sheet.error}</div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-slate-800">{sheet.file?.name}</span>
                      <span>tabs: {sheet.tabs.join(', ') || '—'}</span>
                      {sheet.file?.lastModified && <span>edited {timeAgo(sheet.file.lastModified)}</span>}
                      <span className={cn('rounded-full px-2 py-px text-[10px] font-semibold ring-1', sheet.layout ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200')}
                        title={sheet.layout ? 'Dropdowns, booking colours, today highlight and status colours run inside Excel' : 'Plain workbook: OPS paints the booking colours on each sync; no dropdowns'}>
                        {sheet.layout ? 'OPS layout' : 'Plain layout'}
                      </span>
                    </div>
                    {!sheet.tabExists
                      ? <p className="text-amber-700">The &ldquo;{snap.config.tabName}&rdquo; tab does not exist yet — Prepare sheet (or the first sync) creates it.</p>
                      : sheet.headerRow
                        ? <p>Header on row {sheet.headerRow} · {sheet.dataRows.toLocaleString()} data row(s){sheet.header?.missing.length ? <> · <span className="text-amber-700">missing: {sheet.header.missing.map(k => FEED_COLUMNS.find(c => c.key === k)?.header).join(', ')}</span></> : <> · <span className="text-emerald-700">all {FEED_COLUMNS.length} columns found</span></>}</p>
                        : sheet.dataRows ? <p className="text-rose-700">The tab has data but no feed header — OPS will not write into it. Use an empty tab.</p>
                        : <p>The tab is empty — the first sync writes the header.</p>}
                  </div>
                )}
              </div>
            )}

            {/* Preview */}
            {preview && counts && (
              <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-indigo-900">
                  <Eye className="h-4 w-4" />
                  <b>Preview</b> — computed {timeAgo(preview.run.at)}, nothing written.
                  <span className="text-indigo-700/70">{counts.feedRows.toLocaleString()} OPS movements · {counts.sheetRows.toLocaleString()} rows on the sheet · {counts.unchanged.toLocaleString()} already in step</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {KIND_ORDER.map(k => [k, countOf(counts, k)] as const).map(([k, n]) => {
                    const K = SAMPLE_KIND[k]; const Icon = K.icon
                    return (
                      <button key={k} onClick={() => setTab(k)}
                        className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ring-1 transition', K.tone, tab === k ? 'shadow-sm ring-2' : 'opacity-80 hover:opacity-100')}>
                        <Icon className="h-3.5 w-3.5" />
                        <span className="text-lg font-bold leading-none tabular-nums">{n.toLocaleString()}</span>
                        <span className="text-[11px] font-medium leading-tight">{K.label}</span>
                      </button>
                    )
                  })}
                </div>
                {preview.run.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{w}</p>
                ))}
                {tab === 'conflict' && snap.canAdmin && preview.samples.some(s => s.kind === 'conflict') && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[11px] text-orange-800 ring-1 ring-orange-100">
                    <GitMerge className="h-3.5 w-3.5" /> Changed in OPS <i>and</i> in the Excel since the last sync — neither side is touched until you choose.
                    <span className="flex-1" />
                    <button onClick={() => settle(preview.samples.filter(s => s.kind === 'conflict'), 'ops')} disabled={busy !== null} className="rounded-md bg-white px-2 py-0.5 font-semibold text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50">Keep OPS for all shown</button>
                    <button onClick={() => settle(preview.samples.filter(s => s.kind === 'conflict'), 'excel')} disabled={busy !== null} className="rounded-md bg-white px-2 py-0.5 font-semibold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50">Keep Excel for all shown</button>
                  </div>
                )}
                <SampleList samples={preview.samples.filter(s => s.kind === tab)} kind={tab} total={countOf(counts, tab)}
                  onSettle={snap.canAdmin && busy === null ? settle : undefined} />
                {snap.canAdmin && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-indigo-100 pt-2">
                    <button onClick={() => sync(false)} disabled={busy !== null || snap.running || !(counts.added + counts.updatedRows + counts.markedInactive + counts.toOps)}
                      className="btn btn-sm flex items-center gap-1.5 border border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                      {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />} Write these changes
                    </button>
                    {counts.deletedInExcel > 0 && (
                      <button onClick={() => sync(true)} disabled={busy !== null || snap.running} className="btn btn-ghost btn-sm text-xs text-rose-700"
                        title="Rows the desk deleted are normally left out. This puts them back once.">
                        {busy === 'restore' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Put back {counts.deletedInExcel} deleted row(s)
                      </button>
                    )}
                    {preview.samples.some(s => s.waiting?.startsWith('Held back')) && (
                      <button onClick={() => sync(false, true)} disabled={busy !== null || snap.running} className="btn btn-ghost btn-sm text-xs text-violet-700"
                        title="More Excel → OPS changes arrived at once than the safety limit. Sends them all (each still checked against OPS first).">
                        {busy === 'bulk' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Send all {counts.toOpsWaiting} to OPS
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Columns */}
            <details className="group rounded-lg border border-slate-200">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-600">
                Columns ({FEED_COLUMNS.filter(c => c.source === 'ops').length} from OPS · {FEED_COLUMNS.filter(c => c.source === 'both').length} both ways · {FEED_COLUMNS.filter(c => c.source === 'desk').length} typed by the desk), colours and dropdowns
              </summary>
              <div className="space-y-3 border-t border-slate-100 px-3 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {FEED_COLUMNS.map(c => (
                    <span key={c.key} title={c.hint}
                      className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', c.source === 'ops' ? 'bg-teal-700 text-white' : c.source === 'both' ? 'bg-violet-700 text-white' : 'bg-amber-200 text-amber-900')}>
                      {c.header}{c.list ? ' ▾' : ''}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Columns are found by their <b>header text</b>, so the desk can move, hide or add columns. Keep the <b>Agenda Line ID</b> column — it ties each row to its movement
                  (a chart save gives movements new ids; OPS carries the row across, with everything typed on it). ▾ = dropdown: Location, Service Type and Meal Plan offer the agenda&apos;s
                  own values; Type of Car, QC, Tickets and Meal Preference read the desk&apos;s lists on the <b>Lists</b> tab. Free typing is always allowed.
                </p>
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                  <Info className="mt-px h-3 w-3 shrink-0" />
                  Microsoft Graph cannot add dropdowns to a workbook that is in use, so they come with the layout: <b>Prepare sheet</b> on an <b>empty</b> workbook installs everything;
                  on a workbook with data, start from the <b>Template</b> download (or copy its Lists tab and Data → Data Validation).
                </p>
              </div>
            </details>

            {/* Runs */}
            {snap.runs.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent runs</p>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {snap.runs.slice(0, 8).map(r => {
                    const s = r.trigger === 'PREVIEW' ? { icon: Eye, tone: 'text-indigo-600 bg-indigo-50 ring-indigo-200', label: 'Preview' } : RUN_STYLE[r.status]
                    const Icon = s.icon
                    const c = r.counts
                    return (
                      <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', s.tone)}>
                          <Icon className="h-3 w-3" /> {s.label}
                        </span>
                        <span className="text-slate-600">{new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">{r.trigger}{r.by ? ` · ${r.by}` : ''}</span>
                        {c && r.status !== 'FAILED' && (
                          <span className="text-slate-500"><b className="text-emerald-600">+{c.added}</b> · <b className="text-amber-600">~{c.updatedRows}</b> · <b className="text-slate-500">⚑{c.markedInactive}</b>{c.rekeyed ? <> · <b className="text-indigo-600">↻{c.rekeyed}</b></> : null}</span>
                        )}
                        {r.durationMs !== null && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400"><Clock className="h-3 w-3" />{(r.durationMs / 1000).toFixed(1)} s</span>}
                        {r.error && <p className="w-full truncate text-[11px] text-rose-600" title={r.error}>{r.error}</p>}
                        {!r.error && r.warnings[0] && <p className="w-full truncate text-[11px] text-amber-600" title={r.warnings.join('\n')}>{r.warnings[0]}</p>}
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

function countOf(c: FeedCounts, k: PlanSample['kind']): number {
  switch (k) {
    case 'add': return c.added
    case 'update': return c.updatedRows
    case 'toOps': return c.toOps + c.toOpsWaiting
    case 'conflict': return c.conflicts
    case 'rekey': return c.rekeyed
    case 'inactive': return c.markedInactive
    case 'deleted': return c.deletedInExcel
  }
}

function SampleList({ samples, kind, total, onSettle }: {
  samples: PlanSample[]; kind: PlanSample['kind']; total: number
  onSettle?: (items: PlanSample[], keep: 'ops' | 'excel') => void
}) {
  if (!total) return <p className="py-3 text-center text-xs text-slate-400">Nothing in this group.</p>
  const twoWay = kind === 'toOps' || kind === 'conflict'
  return (
    <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
      {samples.map((s, i) => (
        <div key={i} className={cn('rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1', s.waiting ? 'ring-slate-200 opacity-80' : 'ring-slate-100')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-slate-800">{s.bookingRef}</span>
            {s.date && <span className="text-slate-500">{fmtDay(s.date)}</span>}
            {s.field && <span className="rounded bg-violet-100 px-1.5 py-px text-[10px] font-semibold text-violet-700">{fieldName(s.field)}</span>}
            <span className="min-w-0 flex-1 truncate text-slate-600">{s.label}</span>
            {s.row !== null && <span className="font-mono text-[10px] text-slate-400">{kind === 'add' ? 'at row ' : 'row '}{s.row}</span>}
          </div>
          {s.changes && s.changes.length > 0 && (
            <div className="mt-1 space-y-0.5 pl-1">
              {s.changes.slice(0, 6).map((c, j) => (
                <div key={j} className="flex items-start gap-1.5 text-[11px]">
                  <span className="w-28 shrink-0 font-semibold text-slate-500">{twoWay ? (kind === 'conflict' ? 'OPS / Excel' : 'OPS → Excel value') : c.column}</span>
                  <span className={cn('truncate', twoWay ? 'font-medium text-teal-700' : 'text-rose-600 line-through decoration-rose-300')}>{c.from || '—'}</span>
                  {kind === 'conflict' ? <span className="text-slate-300">vs</span> : <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-300" />}
                  <span className={cn('truncate', twoWay ? 'font-medium text-violet-700' : 'text-emerald-700')}>{c.to || '—'}</span>
                </div>
              ))}
            </div>
          )}
          {s.waiting && <p className="mt-0.5 pl-1 text-[11px] italic text-slate-500">Waiting: {s.waiting}</p>}
          {kind === 'conflict' && onSettle && (
            <div className="mt-1 flex gap-1.5 pl-1">
              <button onClick={() => onSettle([s], 'ops')} className="rounded bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 ring-1 ring-teal-200 hover:bg-teal-100">Keep OPS</button>
              <button onClick={() => onSettle([s], 'excel')} className="rounded bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100">Keep Excel</button>
            </div>
          )}
        </div>
      ))}
      {total > samples.length && <p className="pt-1 text-center text-[11px] text-slate-400">…and {(total - samples.length).toLocaleString()} more</p>}
    </div>
  )
}
