'use client'

/**
 * Excel MC Generate — Vietnam (VN…) bookings only.
 *
 * A toolbar button that reads this booking's rows from the VN desk's
 * "(VN TEAM) Movement Chart" workbook and turns them into movement-chart lines,
 * driver allocation included. Nothing is written until the operator confirms in
 * the review panel; the save goes through the page's ordinary chart save.
 *
 * Once a chart has been saved from the sheet the button keeps watching: when
 * the desk edits the workbook it shows "Sheet updated · N" and the review
 * pre-ticks only what changed in Excel — edits made in OPS since are kept.
 *
 * See lib/vn-mc-import/shared.ts for the matching and merge rules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  FileSpreadsheet, RefreshCw, X, Loader2, CheckCircle2, AlertTriangle, Info, ExternalLink,
  Plus, PencilLine, Equal, MinusCircle, ArrowRight, Phone, Clock, MapPin, MessageCircle, Save, ListChecks,
  Zap, PauseCircle, PlayCircle,
} from 'lucide-react'
import { to12h } from '@/lib/clock-time'
import { serviceTypeShortLabel } from '@/lib/service-types'
import { timeAgo } from '@/lib/vn-driver-sync/shared'
import {
  applyPlan, buildChecks, buildPlan, defaultSelection, FIELD_LABELS, summarise,
  type ChartItemLike, type FieldKey, type McSheetLine, type McSheetPayload, type PlanRow, type PlanSelection,
} from '@/lib/vn-mc-import/shared'

export interface ExcelMcApply<T> {
  items: T[]
  /** true: save now. false: load into the editor and let the operator save. */
  save: boolean
  notifyDrivers: boolean
  /** Fingerprints of the sheet rows this chart was built from (the next baseline). */
  keys: string[]
  title: string | null
  /** For the agenda's Booking Logs: what this import changed, row by row. */
  origin: {
    kind: 'excel'
    sheetTitle: string | null
    added: number; updated: number; removed: number; fieldsChanged: number
    rows: { label: string; fields: string[]; kind: string }[]
  }
}

interface BookingLite {
  paxAdults: number; paxChildren: number; paxInfants: number
  arrivalDate?: string | null; departureDate?: string | null
  flights?: { flightNo: string; date?: string | null }[]
}

interface Props<T extends ChartItemLike> {
  bookingRef: string
  booking: BookingLite | null
  items: T[]
  canEdit: boolean
  makeItem: (line: McSheetLine) => T
  onApply: (r: ExcelMcApply<T>) => Promise<void>
  /** The chart is being edited on screen — never reload it under the operator. */
  editing?: boolean
  /** The server changed the chart (auto-update ran): reload it. */
  onServerChanged?: () => void
}

const KIND = {
  NEW:         { label: 'New',         icon: Plus,        tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-400' },
  CHANGED:     { label: 'Changed',     icon: PencilLine,  tone: 'bg-amber-50 text-amber-700 ring-amber-200',       bar: 'bg-amber-400' },
  SAME:        { label: 'Same',        icon: Equal,       tone: 'bg-slate-100 text-slate-500 ring-slate-200',      bar: 'bg-slate-200' },
  SYSTEM_ONLY: { label: 'Only in OPS', icon: MinusCircle, tone: 'bg-violet-50 text-violet-700 ring-violet-200',    bar: 'bg-violet-300' },
} as const

type Filter = 'action' | 'all' | 'same'

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function dayNo(iso: string, arrival?: string | null): number | null {
  if (!arrival) return null
  const a = new Date(`${arrival.slice(0, 10)}T00:00:00`).getTime()
  const d = new Date(`${iso}T00:00:00`).getTime()
  if (Number.isNaN(a) || Number.isNaN(d)) return null
  return Math.round((d - a) / 86_400_000) + 1
}

function showValue(key: FieldKey, v: string): string {
  if (!v) return '—'
  if (key === 'meetingTime') return to12h(v)
  if (key === 'serviceType') return serviceTypeShortLabel(v)
  return v
}

export default function ExcelMcGenerate<T extends ChartItemLike>({ bookingRef, booking, items, canEdit, makeItem, onApply, editing = false, onServerChanged }: Props<T>) {
  const [payload, setPayload] = useState<McSheetPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [mirror, setMirror] = useState(false)
  const [filter, setFilter] = useState<Filter>('action')
  const [sel, setSel] = useState<PlanSelection>({ rows: {}, fields: {} })
  const [notify, setNotify] = useState(false)
  const [busy, setBusy] = useState<'save' | 'editor' | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/agenda/mc-sheet${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error || `Could not read the sheet (${res.status})`)
      setPayload(json.data as McSheetPayload)
      return json.data as McSheetPayload
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the sheet')
      return null
    } finally { setLoading(false) }
  }, [bookingRef])

  // A quiet look on open of the page, so the button can say "Sheet updated" —
  // then every 5 minutes, so a chart the Excel auto-update changed is reloaded
  // on screen (never while it is being edited; the save guard covers that).
  const lastAutoAt = useRef<string | null | undefined>(undefined)
  const editingRef = useRef(editing)
  editingRef.current = editing
  useEffect(() => {
    let alive = true
    const look = async () => {
      const p = await load(false)
      if (!alive || !p) return
      const at = p.baseline?.autoAt ?? null
      if (lastAutoAt.current !== undefined && at && at !== lastAutoAt.current && !editingRef.current) {
        toast.info('The movement chart was updated from the Excel', { description: 'Every change is in the chart logs.' })
        onServerChanged?.()
      }
      lastAutoAt.current = at
    }
    void look()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void look() }, 5 * 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  const [autoBusy, setAutoBusy] = useState(false)
  const auto = payload?.auto
  const autoLive = Boolean(payload?.baseline && !payload.baseline.paused && auto?.mode === 'AUTO')

  async function post(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    setAutoBusy(true)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`)
      return json.data ?? {}
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
      return null
    } finally { setAutoBusy(false) }
  }

  async function togglePause() {
    const paused = !payload?.baseline?.paused
    if (await post(`/api/bookings/${encodeURIComponent(bookingRef)}/agenda/mc-sheet`, { pause: paused })) {
      toast.success(paused ? 'Automatic Excel updates paused for this chart' : 'Automatic Excel updates resumed for this chart')
      await load(false)
    }
  }

  async function setGlobal(mode: 'OFF' | 'AUTO') {
    if (mode === 'AUTO' && !window.confirm('Switch ON automatic Excel updates for every VN chart that was built from the Excel?\n\nEvery ' + (auto?.intervalMin ?? 15) + ' minutes OPS will refresh those charts from the Movement Chart Excel: fields still holding Excel data are updated and new Excel rows are added. OPS edits, drivers and deletions are never touched, no WhatsApp is sent, and every change is logged.')) return
    if (await post('/api/vn-mc-auto', { mode })) {
      toast.success(mode === 'AUTO' ? 'Excel auto-update switched ON' : 'Excel auto-update switched OFF')
      await load(false)
    }
  }

  async function runNow() {
    const r = await post(`/api/bookings/${encodeURIComponent(bookingRef)}/agenda/mc-sheet`, { action: 'run' }) as
      { fields?: number; created?: number; keptOps?: number; skipped?: string } | null
    if (!r) return
    if (r.skipped) toast.info(`Nothing applied — ${r.skipped}`)
    else toast.success(`Applied from the Excel: ${r.fields ?? 0} field(s), +${r.created ?? 0} movement(s)${r.keptOps ? ` · ${r.keptOps} OPS edit(s) kept` : ''}`)
    if (r.fields || r.created) { onServerChanged?.(); setOpen(false) }
    await load(false)
  }

  const plan = useMemo(() => (payload ? buildPlan(items, payload.lines, payload.baseline) : []), [items, payload])
  const summary = useMemo(() => summarise(plan), [plan])
  const checks = useMemo(() => (payload ? buildChecks(booking, payload.lines) : []), [booking, payload])

  // Fresh ticks whenever the plan is rebuilt from a new read or the mode flips.
  useEffect(() => { if (open) setSel(defaultSelection(plan, mirror)) }, [open, payload, mirror]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => applyPlan(items, plan, sel, makeItem), [items, plan, sel, makeItem])

  async function openPanel() {
    setOpen(true)
    setFilter('action')
    setExpanded(new Set())
    // The page-load look may be minutes old — read again (the server still caches 15 s).
    await load(true)
  }

  const toggleRow = (r: PlanRow) => setSel(s => {
    const on = !s.rows[r.id]
    const fields = { ...s.fields }
    if (r.kind === 'CHANGED') {
      // Ticking a row turns on its recommended fields — or every open field
      // when none is recommended (an OPS edit the operator chose to overwrite).
      const recommended = r.fields.some(f => !f.locked && f.defaultOn)
      fields[r.id] = Object.fromEntries(r.fields.map(f => [f.key, on && !f.locked && (f.defaultOn || !recommended)]))
      if (on && !Object.values(fields[r.id]).some(Boolean)) return s   // every field locked
    }
    return { rows: { ...s.rows, [r.id]: on }, fields }
  })

  const toggleField = (r: PlanRow, key: FieldKey) => setSel(s => {
    const f = { ...(s.fields[r.id] ?? {}), [key]: !s.fields[r.id]?.[key] }
    return { rows: { ...s.rows, [r.id]: Object.values(f).some(Boolean) }, fields: { ...s.fields, [r.id]: f } }
  })

  function bulk(kind: 'all' | 'none' | 'updates') {
    setSel(s => {
      const next: PlanSelection = { rows: { ...s.rows }, fields: { ...s.fields } }
      for (const r of plan) {
        if (r.kind === 'SAME' || r.kind === 'SYSTEM_ONLY') continue
        const on = kind === 'all' ? true : kind === 'none' ? false : r.sheetUpdated
        next.rows[r.id] = on
        if (r.kind === 'CHANGED') next.fields[r.id] = Object.fromEntries(r.fields.map(f => [f.key, on && !f.locked && (kind === 'all' || f.defaultOn || r.sheetUpdated)]))
      }
      return next
    })
  }

  async function confirm(save: boolean) {
    if (!payload) return
    if (!preview.items.length) { toast.error('That would leave the chart empty — tick at least one row'); return }
    const bad = preview.items.findIndex(i => !i.date)
    if (bad !== -1) { toast.error(`Movement ${bad + 1} has no date`); return }
    setBusy(save ? 'save' : 'editor')
    const label = (r: PlanRow) => {
      const cur = r.index !== null ? items[r.index] : null
      const from = (r.line?.from ?? cur?.fromPoint ?? '').replace(/\n/g, ', ')
      const to = (r.line?.to ?? cur?.toPoint ?? '').replace(/\n/g, ', ')
      return `${fmtDay(r.date)} · ${[from, to].filter(Boolean).join(' → ') || (r.line?.location ?? cur?.location ?? '')}`
    }
    const logRows = plan.flatMap(r => {
      if (!sel.rows[r.id]) return []
      if (r.kind === 'NEW' || r.kind === 'SYSTEM_ONLY') return [{ kind: r.kind, label: label(r), fields: [] as string[] }]
      if (r.kind !== 'CHANGED') return []
      const fields = r.fields.filter(f => !f.locked && sel.fields[r.id]?.[f.key])
        .map(f => (f.key === 'details' ? 'Details' : `${FIELD_LABELS[f.key]}: ${showValue(f.key, f.current)} → ${showValue(f.key, f.sheet)}`.slice(0, 120)))
      return fields.length ? [{ kind: r.kind, label: label(r), fields }] : []
    })
    try {
      await onApply({
        items: preview.items, save, notifyDrivers: notify,
        keys: payload.lines.map(l => l.key), title: payload.sheet.title,
        origin: {
          kind: 'excel', sheetTitle: payload.sheet.title,
          added: preview.added, updated: preview.updated, removed: preview.removed, fieldsChanged: preview.fieldsChanged,
          rows: logRows,
        },
      })
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not apply the sheet')
    } finally { setBusy(null) }
  }

  // ── Button ────────────────────────────────────────────────────────────────

  const lines = payload?.lines.length ?? 0
  const updates = payload?.baseline ? summary.pendingUpdates : 0
  const badge = error ? null
    : updates > 0 ? { text: `Sheet updated · ${updates}`, tone: 'bg-amber-500 text-white animate-pulse' }
    : lines && !items.length ? { text: `${lines} ready`, tone: 'bg-emerald-600 text-white' }
    : payload?.baseline && lines ? { text: 'In sync', tone: 'bg-emerald-100 text-emerald-700' }
    : null

  const visible = plan.filter(r => filter === 'all' ? true : filter === 'same' ? r.kind === 'SAME' : r.kind !== 'SAME')
  const byDay = visible.reduce<Record<string, PlanRow[]>>((acc, r) => { (acc[r.date] ||= []).push(r); return acc }, {})

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        disabled={!canEdit}
        title={!canEdit ? 'You cannot edit this chart' : 'Build or refresh the movement chart from the VN team Movement Chart Excel (drivers included) — you review before anything is saved'}
        className="group relative btn btn-sm flex items-center gap-1.5 border border-emerald-700 bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50"
      >
        {loading && !open ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
        Excel MC Generate
        {autoLive && (
          <span title={`Auto-updating from the Excel every ${auto?.intervalMin ?? 15} min`}
            className="ml-0.5 inline-flex items-center rounded-full bg-white/20 px-1 py-px"><Zap className="h-3 w-3 fill-yellow-300 text-yellow-300" /></span>
        )}
        {badge && (
          <span className={`absolute -top-2 -right-2 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-bold shadow ring-2 ring-white ${badge.tone}`}>
            {badge.text}
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-stretch justify-center p-2 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !busy && setOpen(false)} />
          <div className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

            {/* Header */}
            <div className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 via-white to-teal-50 px-5 py-4">
              <div className="rounded-xl bg-emerald-600 p-2.5 text-white shadow"><FileSpreadsheet className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-slate-800">Excel MC Generate — {bookingRef}</h2>
                <p className="truncate text-xs text-slate-500">
                  {payload?.sheet.title ?? 'VN TEAM Movement Chart'}
                  {payload && <> · read {timeAgo(payload.sheet.readAt)}{payload.sheet.fromCache ? ' (cached)' : ''} · {lines} row{lines === 1 ? '' : 's'} for this booking</>}
                  {payload?.baseline && <> · last built from the sheet {timeAgo(payload.baseline.at)}{payload.baseline.by ? ` by ${payload.baseline.by}` : ''}</>}
                </p>
              </div>
              {payload?.sheet.url && (
                <a href={payload.sheet.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm flex items-center gap-1.5">
                  <ExternalLink className="h-4 w-4" /> Open Excel
                </a>
              )}
              <button onClick={() => load(true)} disabled={loading} className="btn btn-secondary btn-sm flex items-center gap-1.5">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button onClick={() => !busy && setOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>

            {/* Automatic updates */}
            {payload && auto && (
              <div className={`flex flex-wrap items-center gap-2 border-b px-5 py-2 text-xs ${autoLive ? 'border-yellow-100 bg-yellow-50/70 text-yellow-900' : 'border-slate-100 bg-slate-50 text-slate-600'}`}>
                <Zap className={`h-4 w-4 ${autoLive ? 'fill-yellow-400 text-yellow-500' : 'text-slate-400'}`} />
                <span className="min-w-0 flex-1">
                  {!payload.baseline
                    ? <>Automatic updates start once this chart is <b>saved from the Excel</b> — after that OPS keeps it in step with the Excel{auto.mode === 'AUTO' ? ` every ${auto.intervalMin} min` : ' (when an admin switches auto-update on)'}.</>
                    : auto.mode !== 'AUTO'
                      ? <>Built from the Excel. Automatic updates are <b>switched off</b> for all charts{auto.canAdmin ? '' : ' — ask an admin'}.</>
                      : payload.baseline.paused
                        ? <>Built from the Excel. Automatic updates are <b>paused for this chart</b>.</>
                        : <>
                            <b>Auto-updating from the Excel</b> every {auto.intervalMin} min — Excel values refresh, new Excel rows are added; OPS edits, drivers and deletions are left alone; no WhatsApp.
                            {payload.baseline.autoAt && <> Last change {timeAgo(payload.baseline.autoAt)}.</>}
                            {auto.lastRun && <> Last run {timeAgo(auto.lastRun.at)}{auto.lastRun.status === 'FAILED' ? ' (failed)' : ''}.</>}
                          </>}
                </span>
                {payload.baseline && canEdit && auto.mode === 'AUTO' && (
                  <button onClick={togglePause} disabled={autoBusy} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium ring-1 ring-slate-200 hover:bg-slate-50">
                    {payload.baseline.paused ? <><PlayCircle className="h-3.5 w-3.5 text-emerald-600" /> Resume for this chart</> : <><PauseCircle className="h-3.5 w-3.5 text-slate-500" /> Pause for this chart</>}
                  </button>
                )}
                {auto.canAdmin && payload.baseline && !payload.baseline.paused && (
                  <button onClick={runNow} disabled={autoBusy} title="Apply the automatic update to this chart now (admins)"
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium ring-1 ring-slate-200 hover:bg-slate-50">
                    {autoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Run now
                  </button>
                )}
                {auto.canAdmin && (
                  <button onClick={() => setGlobal(auto.mode === 'AUTO' ? 'OFF' : 'AUTO')} disabled={autoBusy}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold ring-1 ${auto.mode === 'AUTO' ? 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50' : 'bg-emerald-600 text-white ring-emerald-700 hover:bg-emerald-700'}`}>
                    {auto.mode === 'AUTO' ? 'Switch OFF for all charts' : 'Switch ON auto-update (admin)'}
                  </button>
                )}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading && !payload && (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                  Reading the Movement Chart workbook…
                </div>
              )}
              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
                </div>
              )}
              {payload && !lines && (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-500">
                  <FileSpreadsheet className="h-10 w-10 text-slate-300" />
                  <p className="font-semibold text-slate-700">{bookingRef} is not on the Movement Chart yet</p>
                  <p className="max-w-md text-sm">Tabs read: {payload.sheet.tabs.join(', ') || 'none'}. Once the VN desk adds the rows (Code column = {bookingRef}), press Refresh.</p>
                </div>
              )}

              {payload && lines > 0 && (
                <>
                  {/* Stat strip */}
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['NEW', 'CHANGED', 'SAME', 'SYSTEM_ONLY'] as const).map(k => {
                      const K = KIND[k]; const Icon = K.icon
                      return (
                        <div key={k} className={`flex items-center gap-2 rounded-xl px-3 py-2 ring-1 ${K.tone}`}>
                          <Icon className="h-4 w-4" />
                          <span className="text-xl font-bold leading-none">{summary[k]}</span>
                          <span className="text-xs font-medium">{K.label}</span>
                        </div>
                      )
                    })}
                  </div>

                  {payload.baseline && updates > 0 && (
                    <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <RefreshCw className="h-4 w-4" />
                      The desk changed <b>{updates}</b> row{updates === 1 ? '' : 's'} in Excel since this chart was last built from it — those are ticked. Differences on rows Excel did not change are OPS edits and are left alone.
                    </div>
                  )}

                  {/* Checks */}
                  {checks.length > 0 && (
                    <div className="mb-4 grid gap-1.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2">
                      {checks.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-slate-600">
                          {c.level === 'ok' ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            : c.level === 'warn' ? <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
                            : <Info className="mt-px h-3.5 w-3.5 shrink-0 text-sky-500" />}
                          <span>{c.text}</span>
                        </div>
                      ))}
                      {payload.warnings.map((w, i) => (
                        <div key={`w${i}`} className="flex items-start gap-2 text-xs text-slate-500"><Info className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" />{w}</div>
                      ))}
                    </div>
                  )}

                  {/* Controls */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                      {([['action', 'Needs action'], ['all', 'All rows'], ['same', 'Same']] as const).map(([k, l]) => (
                        <button key={k} onClick={() => setFilter(k)}
                          className={`rounded-md px-3 py-1 ${filter === k ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
                      ))}
                    </div>
                    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium" title="What to do with movements that are in OPS but not in the sheet">
                      <button onClick={() => setMirror(false)} className={`rounded-md px-3 py-1 ${!mirror ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Merge — keep OPS-only rows</button>
                      <button onClick={() => setMirror(true)} className={`rounded-md px-3 py-1 ${mirror ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500'}`}>Mirror the sheet</button>
                    </div>
                    <div className="ml-auto flex gap-1 text-xs">
                      {payload.baseline && <button onClick={() => bulk('updates')} className="rounded-md px-2 py-1 text-amber-700 hover:bg-amber-50">Only Excel updates</button>}
                      <button onClick={() => bulk('all')} className="rounded-md px-2 py-1 text-emerald-700 hover:bg-emerald-50">Tick all</button>
                      <button onClick={() => bulk('none')} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">Untick all</button>
                    </div>
                  </div>

                  {/* Rows by day */}
                  {Object.keys(byDay).length === 0 && (
                    <p className="py-10 text-center text-sm text-slate-500">
                      <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                      The chart already matches the sheet — nothing to do.
                    </p>
                  )}
                  <div className="space-y-4">
                    {Object.entries(byDay).map(([day, rows]) => {
                      const n = dayNo(day, booking?.arrivalDate)
                      return (
                        <div key={day}>
                          <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {n !== null && n > 0 && <span className="rounded bg-slate-800 px-1.5 py-px text-[10px] text-white">Day {n}</span>}
                            {fmtDay(day)}
                            <span className="h-px flex-1 bg-slate-100" />
                          </div>
                          <div className="space-y-2">
                            {rows.map(r => (
                              <PlanCard key={r.id} r={r} items={items} sel={sel} hasBaseline={Boolean(payload.baseline)}
                                expanded={expanded.has(r.id)}
                                onExpand={() => setExpanded(s => { const n2 = new Set(s); n2.has(r.id) ? n2.delete(r.id) : n2.add(r.id); return n2 })}
                                onToggle={() => toggleRow(r)} onToggleField={k => toggleField(r, k)} />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            {payload && lines > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <ListChecks className="h-4 w-4 text-slate-400" />
                  <span><b className="text-emerald-700">+{preview.added}</b> add</span>·
                  <span><b className="text-amber-700">{preview.updated}</b> update ({preview.fieldsChanged} field{preview.fieldsChanged === 1 ? '' : 's'})</span>·
                  <span><b className="text-rose-700">−{preview.removed}</b> remove</span>·
                  <span>{preview.items.length} movements after</span>
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200"
                  title="Saving a chart sends each newly allocated driver number a WhatsApp brief. Off: the chart is saved quietly — brief drivers later from the chart.">
                  <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="accent-green-600" />
                  <MessageCircle className="h-3.5 w-3.5 text-green-600" /> WhatsApp drivers on save
                </label>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setOpen(false)} disabled={Boolean(busy)} className="btn btn-secondary btn-sm">Cancel</button>
                  <button onClick={() => confirm(false)} disabled={Boolean(busy) || loading}
                    title="Put the result in the editor so you can adjust it, then press Save changes"
                    className="btn btn-secondary btn-sm flex items-center gap-1.5">
                    {busy === 'editor' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />} Load into editor
                  </button>
                  <button onClick={() => confirm(true)} disabled={Boolean(busy) || loading || (!preview.added && !preview.updated && !preview.removed && Boolean(items.length))}
                    className="btn btn-sm flex items-center gap-1.5 border border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Confirm &amp; save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function PlanCard<T extends ChartItemLike>({ r, items, sel, hasBaseline, expanded, onExpand, onToggle, onToggleField }: {
  r: PlanRow; items: T[]; sel: PlanSelection; hasBaseline: boolean; expanded: boolean
  onExpand: () => void; onToggle: () => void; onToggleField: (k: FieldKey) => void
}) {
  const K = KIND[r.kind]
  const Icon = K.icon
  const cur = r.index !== null ? items[r.index] : null
  const line = r.line
  const on = Boolean(sel.rows[r.id])
  const time = line?.time ?? cur?.meetingTime ?? ''
  const service = line?.serviceType ?? cur?.serviceType ?? ''
  const from = line?.from ?? cur?.fromPoint ?? ''
  const to = line?.to ?? cur?.toPoint ?? ''
  const selectable = r.kind !== 'SAME'
  const removing = r.kind === 'SYSTEM_ONLY' && on

  return (
    <div className={`relative overflow-hidden rounded-xl border bg-white transition-shadow ${on ? 'border-slate-300 shadow-sm' : 'border-slate-100'} ${removing ? 'opacity-70' : ''}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${K.bar}`} />
      <div className="flex items-start gap-3 py-2.5 pl-4 pr-3">
        {selectable
          ? <input type="checkbox" checked={on} onChange={onToggle} className={`mt-1 h-4 w-4 ${r.kind === 'SYSTEM_ONLY' ? 'accent-rose-600' : 'accent-emerald-600'}`}
              title={r.kind === 'SYSTEM_ONLY' ? 'Tick to remove this movement from the chart' : 'Apply this row'} />
          : <span className="mt-1 h-4 w-4" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px font-semibold ring-1 ${K.tone}`}><Icon className="h-3 w-3" />{K.label}</span>
            {hasBaseline && r.sheetUpdated && <span className="rounded-full bg-amber-500 px-2 py-px font-semibold text-white">Updated in Excel</span>}
            {removing && <span className="rounded-full bg-rose-600 px-2 py-px font-semibold text-white">Will be removed</span>}
            {time && <span className="inline-flex items-center gap-1 text-slate-600"><Clock className="h-3 w-3" />{line?.timeRaw && line.timeRaw !== time ? line.timeRaw : to12h(time)}</span>}
            {service && <span className="rounded bg-slate-100 px-1.5 py-px font-medium text-slate-600">{serviceTypeShortLabel(service)}</span>}
            {(line?.location ?? cur?.location) && <span className="inline-flex items-center gap-1 text-slate-500"><MapPin className="h-3 w-3" />{line?.location ?? cur?.location}</span>}
            {line && <span className="ml-auto font-mono text-[10px] text-slate-400" title="Workbook tab and row">{line.tab}!{line.row}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
            <span className="truncate">{from.replace(/\n/g, ', ') || '—'}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="truncate">{to.replace(/\n/g, ', ') || '—'}</span>
          </div>

          {r.kind === 'CHANGED' && (
            <div className="mt-2 space-y-1">
              {r.fields.map(f => {
                const fOn = Boolean(sel.fields[r.id]?.[f.key])
                const long = f.key === 'details' && !expanded
                return (
                  <label key={f.key} className={`flex items-start gap-2 rounded-lg px-2 py-1 text-xs ${f.locked ? 'cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={fOn} disabled={f.locked} onChange={() => onToggleField(f.key)} className="mt-0.5 accent-emerald-600" />
                    <span className="w-24 shrink-0 font-semibold text-slate-500">{FIELD_LABELS[f.key]}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`${fOn ? 'text-rose-600 line-through decoration-rose-300' : 'text-slate-700'} ${long ? 'line-clamp-1' : 'whitespace-pre-wrap'}`}>{showValue(f.key, f.current)}</span>
                      <span className="mx-1 text-slate-300">→</span>
                      <span className={`${fOn ? 'font-medium text-emerald-700' : 'text-slate-400'} ${long ? 'line-clamp-2' : 'whitespace-pre-wrap'}`}>{showValue(f.key, f.sheet)}</span>
                      {f.note && <span className="block text-[11px] italic text-slate-400">{f.note}</span>}
                    </span>
                  </label>
                )
              })}
              {r.fields.some(f => f.key === 'details') && (
                <button onClick={onExpand} className="ml-8 text-[11px] font-medium text-sky-600 hover:underline">{expanded ? 'Show less' : 'Show full details'}</button>
              )}
            </div>
          )}

          {r.kind === 'NEW' && line && (
            <div className="mt-1.5 space-y-1 text-xs text-slate-600">
              {line.details && <p className={expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'} onClick={onExpand}>{line.details}</p>}
              <div className="flex flex-wrap gap-2">
                {line.meal && <span className="rounded bg-orange-50 px-1.5 py-px text-orange-700">{line.meal}</span>}
                {line.driverName
                  ? <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-px text-blue-700"><Phone className="h-3 w-3" />{line.driverName}</span>
                  : line.vendorText ? <span className="rounded bg-slate-100 px-1.5 py-px text-slate-500" title="No phone number in the Vendors cell — no driver will be set">{line.vendorText} (no number)</span> : null}
              </div>
            </div>
          )}

          {r.kind === 'SYSTEM_ONLY' && cur && (
            <p className="mt-1 line-clamp-1 text-xs text-slate-500">
              {cur.details || 'No details'}{cur.assignment?.driverName ? ` · Driver: ${cur.assignment.driverName}` : ''}
            </p>
          )}
          {r.note && <p className="mt-1 text-[11px] italic text-slate-400">{r.note}</p>}
        </div>
      </div>
    </div>
  )
}
