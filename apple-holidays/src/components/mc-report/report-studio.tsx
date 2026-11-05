'use client'

/**
 * Report Studio — build a PDF from the MC Report and keep it as a template.
 *
 *   left   template rail: starters, the team's shared templates, your own
 *   middle what to print: columns (drag to order), layout, filters & dates, save
 *   right  a live preview — the exact document the PDF is printed from
 *
 * A template carries three things: the chart filters (snapshotted from the page
 * when saved), the columns in order, and the page layout. Picking one applies
 * its filters to the chart, so the preview — and the PDF — is always the chart
 * the desk is looking at.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, FileDown, Printer, Save, Trash2, GripVertical, ChevronUp, ChevronDown, Plus, Minus,
  LayoutTemplate, Columns3, SlidersHorizontal, Filter, Users, Lock, Globe2, Loader2, Sparkles,
  AlertTriangle, Search, Check, Copy, RotateCcw, Maximize2, Minimize2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  ACCENTS, DATE_MODES, DEFAULT_CONFIG, GROUP_BY_OPTIONS, MC_PDF_COLUMNS, MC_PDF_COLUMN_GROUPS, STARTER_TEMPLATES,
  buildMcReportHtml, describeFilters, pdfColumn, pdfFileName,
  type McAccent, type McPdfColumnKey, type McPdfRow, type McReportTemplate, type McTemplateConfig,
  type McTemplateFilters, type McTemplateLayout,
} from '@/lib/mc-report-pdf'

export type SavedTemplate = McReportTemplate & { canEdit?: boolean }

// ─── PDF / print (also used by the page's one-click export) ──────────────────

export interface ExportMeta { dateFrom: string; dateTo: string; filterChips: string[]; generatedBy: string | null }

/** Open the document in a new tab and hand it to the browser's print dialog. */
export function printMcReport(rows: McPdfRow[], config: McTemplateConfig, meta: ExportMeta): boolean {
  const html = buildMcReportHtml(rows, config, {
    ...meta, generatedAt: new Date(), autoPrint: true,
    logoSrc: typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : null,
  })
  const w = window.open('', '_blank')
  if (!w) { toast.error('Allow pop-ups for this site to print'); return false }
  w.document.open(); w.document.write(html); w.document.close()
  return true
}

/** Server PDF; falls back to the print dialog when the host has no Chromium. */
export async function downloadMcPdf(rows: McPdfRow[], config: McTemplateConfig, meta: ExportMeta): Promise<void> {
  if (rows.length === 0) { toast.error('Nothing to export — no movements in this view'); return }
  const res = await fetch('/api/mc-report/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, config, meta: { dateFrom: meta.dateFrom, dateTo: meta.dateTo, filterChips: meta.filterChips } }),
  })
  if (res.status === 503) {
    toast.message('PDF engine unavailable here — opening Print. Choose “Save as PDF”.')
    printMcReport(rows, config, meta)
    return
  }
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw new Error(json?.error ?? `PDF failed (${res.status})`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = pdfFileName(config, meta.dateFrom, meta.dateTo)
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
  toast.success(`PDF downloaded · ${rows.length} movement${rows.length === 1 ? '' : 's'}`)
}

// ─── Small UI bits ───────────────────────────────────────────────────────────

const EMOJIS = ['📄', '🚐', '🛬', '🛫', '🚨', '🤝', '📋', '🗺️', '🏨', '⭐', '🧾', '🎯']

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 text-left">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
      </span>
      <span className={cn('relative w-9 h-5 rounded-full transition-colors flex-shrink-0', on ? 'bg-brand-500' : 'bg-slate-200')}>
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map(o => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className={cn('px-3 py-1.5 text-xs font-semibold rounded-md transition-all',
            value === o.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PageGlyph({ landscape }: { landscape: boolean }) {
  return <span className={cn('inline-block border-2 border-current rounded-[2px] mr-1.5 align-[-2px]', landscape ? 'w-4 h-3' : 'w-3 h-4')} />
}

const sameConfig = (a: McTemplateConfig, b: McTemplateConfig) => JSON.stringify(a) === JSON.stringify(b)

// ─── Studio ──────────────────────────────────────────────────────────────────

type Tab = 'columns' | 'layout' | 'filters' | 'save'

export interface ReportStudioProps {
  open:       boolean
  onClose:    () => void
  rows:       McPdfRow[]
  totalRows:  number
  loading:    boolean
  filters:    McTemplateFilters
  dateFrom:   string
  dateTo:     string
  userName:   string | null
  serviceLabel: (v: string) => string
  /** Apply a template's filters (and date mode) to the chart. */
  onApplyTemplate: (t: McReportTemplate) => void
  /** Remember the last config so the one-click export in the menu reuses it. */
  onConfigChange?: (c: McTemplateConfig) => void
  initialConfig?: McTemplateConfig
  initialTemplateId?: string | null
  onTemplateIdChange?: (id: string | null) => void
  templates:  SavedTemplate[]
  reloadTemplates: () => Promise<void>
}

export default function ReportStudio(props: ReportStudioProps) {
  const {
    open, onClose, rows, totalRows, loading, filters, dateFrom, dateTo, userName, serviceLabel,
    onApplyTemplate, onConfigChange, templates, reloadTemplates,
  } = props

  const [tab, setTab] = useState<Tab>('columns')
  const [config, setConfig] = useState<McTemplateConfig>(props.initialConfig ?? DEFAULT_CONFIG)
  const [activeId, setActiveId] = useState<string | null>(props.initialTemplateId ?? null)
  const [busy, setBusy] = useState<null | 'pdf' | 'save' | 'delete'>(null)
  const [railQuery, setRailQuery] = useState('')
  const [colQuery, setColQuery] = useState('')
  const [dragKey, setDragKey] = useState<McPdfColumnKey | null>(null)
  const [overKey, setOverKey] = useState<McPdfColumnKey | null>(null)
  const [bigPreview, setBigPreview] = useState(false)
  // Save form
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [emoji, setEmoji] = useState('📄')
  const [shared, setShared] = useState(true)

  // The config always carries the chart's live filters — that is what prints.
  const effective = useMemo<McTemplateConfig>(() => ({ ...config, filters }), [config, filters])

  useEffect(() => { onConfigChange?.(effective) }, [effective, onConfigChange])
  useEffect(() => { props.onTemplateIdChange?.(activeId) }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const allTemplates = useMemo<SavedTemplate[]>(() => [...STARTER_TEMPLATES, ...templates], [templates])
  const active = allTemplates.find(t => t.id === activeId) ?? null
  const dirty = !!active && !sameConfig({ ...active.config, filters: active.builtIn ? filters : active.config.filters }, effective)

  // Prefill the save form from whatever is loaded.
  useEffect(() => {
    if (!active) return
    setName(active.builtIn ? `${active.name} (my copy)` : active.name)
    setDescription(active.description ?? '')
    setEmoji(active.emoji || '📄')
    setShared(active.builtIn ? true : !!active.shared)
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filterChips = useMemo(() => describeFilters(filters, serviceLabel), [filters, serviceLabel])
  const meta: ExportMeta = { dateFrom, dateTo, filterChips, generatedBy: userName }

  // ── Preview ────────────────────────────────────────────────────────────────
  const deferredRows = useDeferredValue(rows)
  const deferredConfig = useDeferredValue(effective)
  const previewHtml = useMemo(() => buildMcReportHtml(deferredRows.slice(0, 250), deferredConfig, {
    dateFrom, dateTo, filterChips, generatedBy: userName, generatedAt: new Date(), preview: true,
    logoSrc: typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : null,
  }), [deferredRows, deferredConfig, dateFrom, dateTo, filterChips, userName])

  const frameBox = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [frameHeight, setFrameHeight] = useState(1200)
  const paperWidth = effective.layout.orientation === 'landscape' ? 1240 : 900
  useEffect(() => {
    const el = frameBox.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, (el.clientWidth - 8) / paperWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [paperWidth, open, bigPreview])

  // ── Config helpers ─────────────────────────────────────────────────────────
  const setLayout = (patch: Partial<McTemplateLayout>) => setConfig(c => ({ ...c, layout: { ...c.layout, ...patch } }))
  const setColumns = (columns: McPdfColumnKey[]) => setConfig(c => ({ ...c, columns }))

  function addCol(k: McPdfColumnKey) { if (!config.columns.includes(k)) setColumns([...config.columns, k]) }
  function removeCol(k: McPdfColumnKey) {
    if (config.columns.length <= 1) { toast.error('A report needs at least one column'); return }
    setColumns(config.columns.filter(c => c !== k))
  }
  function moveCol(k: McPdfColumnKey, dir: -1 | 1) {
    const i = config.columns.indexOf(k), j = i + dir
    if (i < 0 || j < 0 || j >= config.columns.length) return
    const next = [...config.columns];[next[i], next[j]] = [next[j], next[i]]
    setColumns(next)
  }
  function dropOn(target: McPdfColumnKey) {
    if (!dragKey || dragKey === target) return
    const next = config.columns.filter(c => c !== dragKey)
    next.splice(next.indexOf(target), 0, dragKey)
    setColumns(next)
  }

  const loadTemplate = useCallback((t: McReportTemplate) => {
    setActiveId(t.id)
    setConfig({ ...t.config })
    onApplyTemplate(t)
    toast.success(`${t.emoji} ${t.name} loaded`, { description: t.builtIn ? 'Filters for who / where on the chart were kept.' : 'Its filters are now on the chart.' })
  }, [onApplyTemplate])

  function startBlank() {
    setActiveId(null)
    setConfig({ ...DEFAULT_CONFIG })
    setName(''); setDescription(''); setEmoji('📄'); setShared(true)
  }

  // Money on a driver's sheet is the one mistake this screen must not make easy.
  const internalOn = config.columns.filter(k => pdfColumn(k)?.internal)
  const driverFacing = config.layout.groupBy === 'driver' || filters.adv.drivers.length > 0
  const showMoneyWarning = internalOn.length > 0 && driverFacing

  // ── Actions ────────────────────────────────────────────────────────────────
  async function exportPdf() {
    setBusy('pdf')
    try { await downloadMcPdf(rows, effective, meta) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'PDF failed') }
    finally { setBusy(null) }
  }

  async function save(asNew: boolean) {
    if (!name.trim()) { setTab('save'); toast.error('Give the template a name'); return }
    setBusy('save')
    try {
      const updating = !asNew && active && !active.builtIn && active.canEdit
      const res = await fetch(updating ? `/api/mc-report/templates/${active!.id}` : '/api/mc-report/templates', {
        method: updating ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description, emoji, shared, config: effective }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Save failed')
      await reloadTemplates()
      setActiveId(json.data.id)
      setConfig(json.data.config)
      toast.success(updating ? 'Template updated' : 'Template saved', { description: shared ? 'Shared with the team' : 'Only you can see it' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(null) }
  }

  async function remove() {
    if (!active || active.builtIn || !active.canEdit) return
    if (!window.confirm(`Delete the template “${active.name}”? This cannot be undone.`)) return
    setBusy('delete')
    try {
      const res = await fetch(`/api/mc-report/templates/${active.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Delete failed')
      await reloadTemplates()
      startBlank()
      toast.success('Template deleted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally { setBusy(null) }
  }

  if (!open) return null

  // ── Rail ───────────────────────────────────────────────────────────────────
  const rq = railQuery.trim().toLowerCase()
  const matches = (t: McReportTemplate) => !rq || `${t.name} ${t.description}`.toLowerCase().includes(rq)
  const mine = templates.filter(t => t.canEdit && matches(t))
  const team = templates.filter(t => !t.canEdit && matches(t))
  const starters = STARTER_TEMPLATES.filter(matches)

  const railItem = (t: SavedTemplate) => {
    const on = t.id === activeId
    const accent = ACCENTS[t.config.layout.accent] ?? ACCENTS.amber
    return (
      <button key={t.id} type="button" onClick={() => loadTemplate(t)}
        className={cn('group w-full text-left rounded-xl border px-3 py-2.5 transition-all',
          on ? 'border-transparent bg-white shadow-md ring-2' : 'border-slate-200 bg-white/60 hover:bg-white hover:shadow-sm')}
        style={on ? { ['--tw-ring-color' as string]: accent.main } : undefined}>
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: accent.soft }}>{t.emoji}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold text-slate-900 truncate">{t.name}</span>
              {!t.builtIn && (t.shared ? <Globe2 className="w-3 h-3 text-sky-500 flex-shrink-0" /> : <Lock className="w-3 h-3 text-slate-400 flex-shrink-0" />)}
            </span>
            {t.description && <span className="block text-[11px] text-slate-500 leading-snug line-clamp-2 mt-0.5">{t.description}</span>}
            <span className="flex items-center gap-1 mt-1.5">
              <span className="h-1 rounded-full" style={{ width: 18, background: accent.main }} />
              <span className="text-[10px] text-slate-400">{t.config.columns.length} cols
                {t.config.layout.groupBy !== 'none' ? ` · by ${GROUP_BY_OPTIONS.find(g => g.key === t.config.layout.groupBy)?.label.toLowerCase()}` : ''}
                {!t.builtIn && !t.canEdit && t.ownerName ? ` · ${t.ownerName}` : ''}</span>
            </span>
          </span>
        </div>
      </button>
    )
  }

  // ── Column picker data ─────────────────────────────────────────────────────
  const cq = colQuery.trim().toLowerCase()
  const available = MC_PDF_COLUMNS.filter(c => !config.columns.includes(c.key) && (!cq || `${c.label} ${c.hint}`.toLowerCase().includes(cq)))

  const accent = ACCENTS[config.layout.accent] ?? ACCENTS.amber

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-slate-900/50 backdrop-blur-sm p-3 md:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative flex flex-col w-full max-w-[1500px] bg-slate-50 rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-slate-200">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow" style={{ background: `linear-gradient(135deg, ${accent.main}, ${accent.ink})` }}>
            <Sparkles className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 leading-tight">Report Studio</h2>
            <p className="text-xs text-slate-500 truncate">
              {active ? <>{active.emoji} <strong>{active.name}</strong>{dirty && <span className="ml-1.5 text-amber-600 font-semibold">· edited</span>}</> : 'Unsaved report'}
              <span className="mx-1.5 text-slate-300">|</span>
              {loading ? 'Loading movements…' : <><strong className="text-slate-700">{rows.length}</strong> of {totalRows} movements in this view</>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => printMcReport(rows, effective, meta)} disabled={!rows.length}
              className="btn btn-secondary btn-sm"><Printer className="w-4 h-4" /> Print</button>
            <button onClick={exportPdf} disabled={busy === 'pdf' || !rows.length || loading}
              className="btn btn-primary btn-sm">
              {busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              Download PDF
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Close (Esc)"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">

          {/* ── Rail ──────────────────────────────────────────────────────── */}
          <aside className={cn('w-72 flex-shrink-0 border-r border-slate-200 bg-slate-100/60 flex flex-col', bigPreview && 'hidden')}>
            <div className="p-3 space-y-2 border-b border-slate-200">
              <button onClick={startBlank} className="w-full btn btn-secondary btn-sm justify-center"><Plus className="w-4 h-4" /> New from current view</button>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={railQuery} onChange={e => setRailQuery(e.target.value)} placeholder="Find a template"
                  className="form-input w-full pl-8 py-1.5 text-sm" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {mine.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"><Users className="w-3 h-3" /> My templates</p>
                  {mine.map(railItem)}
                </div>
              )}
              {team.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"><Globe2 className="w-3 h-3" /> Shared by the team</p>
                  {team.map(railItem)}
                </div>
              )}
              {starters.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"><LayoutTemplate className="w-3 h-3" /> Starters</p>
                  {starters.map(railItem)}
                </div>
              )}
              {!mine.length && !team.length && !starters.length && <p className="text-xs text-slate-400 text-center py-6">No template matches “{railQuery}”</p>}
            </div>
          </aside>

          {/* ── Editor ────────────────────────────────────────────────────── */}
          <section className={cn('w-[400px] flex-shrink-0 border-r border-slate-200 bg-white flex flex-col', bigPreview && 'hidden')}>
            <div className="flex border-b border-slate-200 px-2">
              {([
                ['columns', 'Columns', Columns3], ['layout', 'Layout', SlidersHorizontal],
                ['filters', 'Filters', Filter], ['save', 'Save', Save],
              ] as const).map(([k, label, Icon]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={cn('flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors',
                    tab === k ? 'border-brand-500 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
                  <Icon className="w-3.5 h-3.5" /> {label}
                  {k === 'columns' && <span className="ml-0.5 text-[10px] bg-slate-100 text-slate-500 rounded-full px-1.5">{config.columns.length}</span>}
                  {k === 'filters' && filterChips.length > 0 && <span className="ml-0.5 text-[10px] bg-brand-100 text-brand-700 rounded-full px-1.5">{filterChips.length}</span>}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {tab === 'columns' && (
                <div className="p-4 space-y-4">
                  {showMoneyWarning && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 flex gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>This looks like a <strong>driver-facing</strong> sheet but includes {internalOn.map(k => pdfColumn(k)?.label).join(', ')}. Internal figures should not go to drivers.
                        <button onClick={() => setColumns(config.columns.filter(k => !pdfColumn(k)?.internal))} className="ml-1 underline font-semibold">Remove them</button></span>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">In the report · drag to reorder</p>
                      <button onClick={() => setColumns(DEFAULT_CONFIG.columns)} className="text-[11px] text-slate-400 hover:text-slate-700 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Reset</button>
                    </div>
                    <ul className="space-y-1">
                      {config.columns.map((k, i) => {
                        const c = pdfColumn(k)
                        if (!c) return null
                        return (
                          <li key={k} draggable
                            onDragStart={e => { setDragKey(k); e.dataTransfer.effectAllowed = 'move' }}
                            onDragOver={e => { e.preventDefault(); setOverKey(k) }}
                            onDragLeave={() => setOverKey(o => (o === k ? null : o))}
                            onDrop={e => { e.preventDefault(); dropOn(k); setDragKey(null); setOverKey(null) }}
                            onDragEnd={() => { setDragKey(null); setOverKey(null) }}
                            className={cn('group flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 text-sm transition-all',
                              dragKey === k ? 'opacity-40' : '',
                              overKey === k && dragKey && dragKey !== k ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-200',
                              c.internal && 'bg-rose-50/50')}>
                            <GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing flex-shrink-0" />
                            <span className="w-5 text-[10px] text-slate-400 font-mono">{i + 1}</span>
                            <span className="flex-1 min-w-0">
                              <span className="font-medium text-slate-800">{c.label}</span>
                              {c.internal && <span className="ml-1.5 text-[9px] font-bold uppercase text-rose-600">internal</span>}
                              <span className="block text-[10px] text-slate-400 truncate">{c.hint}</span>
                            </span>
                            <span className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => moveCol(k, -1)} className="p-0.5 text-slate-400 hover:text-slate-800" title="Move up"><ChevronUp className="w-3.5 h-3.5" /></button>
                              <button onClick={() => moveCol(k, 1)} className="p-0.5 text-slate-400 hover:text-slate-800" title="Move down"><ChevronDown className="w-3.5 h-3.5" /></button>
                            </span>
                            <button onClick={() => removeCol(k)} className="p-1 rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50" title="Remove"><Minus className="w-3.5 h-3.5" /></button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Add columns</p>
                    <div className="relative mb-2">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input value={colQuery} onChange={e => setColQuery(e.target.value)} placeholder="Search columns" className="form-input w-full pl-8 py-1.5 text-sm" />
                    </div>
                    {MC_PDF_COLUMN_GROUPS.map(g => {
                      const list = available.filter(c => c.group === g)
                      if (!list.length) return null
                      return (
                        <div key={g} className="mb-3">
                          <p className="text-[10px] text-slate-400 font-semibold mb-1">{g}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {list.map(c => (
                              <button key={c.key} onClick={() => addCol(c.key)} title={c.hint}
                                className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                                  c.internal ? 'border-rose-200 text-rose-700 hover:bg-rose-50' : 'border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50')}>
                                <Plus className="w-3 h-3" /> {c.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    {!available.length && <p className="text-xs text-slate-400">Every column is already in the report.</p>}
                  </div>
                </div>
              )}

              {tab === 'layout' && (
                <div className="p-4 space-y-5">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Title</label>
                    <input value={config.title} onChange={e => setConfig(c => ({ ...c, title: e.target.value }))} className="form-input w-full text-sm" maxLength={120} />
                    <input value={config.subtitle} onChange={e => setConfig(c => ({ ...c, subtitle: e.target.value }))} className="form-input w-full text-sm" placeholder="Subtitle (optional)" maxLength={200} />
                    <textarea value={config.notes} onChange={e => setConfig(c => ({ ...c, notes: e.target.value }))} rows={2} maxLength={1000}
                      className="form-input w-full text-sm" placeholder="Note printed under the title — e.g. “Call the desk on +94 … if a guest is late”" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Page</p>
                      <Segmented value={config.layout.orientation} onChange={v => setLayout({ orientation: v })}
                        options={[{ key: 'landscape', label: <><PageGlyph landscape />Wide</> }, { key: 'portrait', label: <><PageGlyph landscape={false} />Tall</> }]} />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Paper</p>
                      <Segmented value={config.layout.paper} onChange={v => setLayout({ paper: v })} options={[{ key: 'A4', label: 'A4' }, { key: 'A3', label: 'A3' }]} />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Density</p>
                      <Segmented value={config.layout.density} onChange={v => setLayout({ density: v })} options={[{ key: 'comfortable', label: 'Comfortable' }, { key: 'compact', label: 'Compact' }]} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Group rows by</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {GROUP_BY_OPTIONS.map(g => (
                        <button key={g.key} onClick={() => setLayout({ groupBy: g.key, ...(g.key === 'none' ? { pageBreakPerGroup: false } : {}) })}
                          className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-left transition-colors',
                            config.layout.groupBy === g.key ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                          {config.layout.groupBy === g.key && <Check className="w-3 h-3 inline mr-1" />}{g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="-mx-3">
                    {config.layout.groupBy !== 'none' && (
                      <Toggle on={config.layout.pageBreakPerGroup} onChange={v => setLayout({ pageBreakPerGroup: v })}
                        label="New page for each group" hint="One sheet per driver, agent, day…" />
                    )}
                    <Toggle on={config.layout.showStats} onChange={v => setLayout({ showStats: v })} label="Summary tiles" hint="Movements, files, pax, arrivals, unallocated" />
                    <Toggle on={config.layout.showFilters} onChange={v => setLayout({ showFilters: v })} label="Print the filters used" />
                    <Toggle on={config.layout.showSignature} onChange={v => setLayout({ showSignature: v })} label="Signature block"
                      hint={config.layout.groupBy === 'driver' ? 'Prepared by · Driver acknowledgement · Date' : 'Prepared · Checked · Approved'} />
                    <Toggle on={config.layout.zebra} onChange={v => setLayout({ zebra: v })} label="Striped rows" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Accent</p>
                    <div className="flex gap-2">
                      {(Object.keys(ACCENTS) as McAccent[]).map(k => (
                        <button key={k} onClick={() => setLayout({ accent: k })} title={ACCENTS[k].name}
                          className={cn('w-8 h-8 rounded-full border-2 transition-transform', config.layout.accent === k ? 'border-slate-900 scale-110' : 'border-white shadow')}
                          style={{ background: ACCENTS[k].main }}>
                          {config.layout.accent === k && <Check className="w-4 h-4 text-white mx-auto" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'filters' && (
                <div className="p-4 space-y-5">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Chart filters in this report</p>
                    {filterChips.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {filterChips.map(c => <span key={c} className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">{c}</span>)}
                      </div>
                    ) : <p className="text-xs text-slate-500">No filters — every movement in the date range prints.</p>}
                    <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                      Change these on the chart behind this window — the preview follows. Saving the template keeps them, and picking the template later puts them back.
                    </p>
                    <button onClick={onClose} className="mt-2 text-xs font-semibold text-brand-700 hover:underline">Close Studio to adjust filters →</button>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Dates when this template is picked</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {DATE_MODES.map(d => (
                        <button key={d.key} onClick={() => setConfig(c => ({ ...c, dateMode: d.key }))}
                          className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-left',
                            config.dateMode === d.key ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                            d.key === 'keep' && 'col-span-2')}>
                          {config.dateMode === d.key && <Check className="w-3 h-3 inline mr-1" />}{d.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400">“Tomorrow” makes a template you can open every evening for the next day’s duty sheets.</p>
                  </div>
                </div>
              )}

              {tab === 'save' && (
                <div className="p-4 space-y-4">
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Icon</p>
                    <div className="flex flex-wrap gap-1.5">
                      {EMOJIS.map(e => (
                        <button key={e} onClick={() => setEmoji(e)}
                          className={cn('w-9 h-9 rounded-lg text-lg border transition-all', emoji === e ? 'border-brand-400 bg-brand-50 scale-110' : 'border-slate-200 hover:bg-slate-50')}>{e}</button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Name</label>
                    <input value={name} onChange={e => setName(e.target.value)} maxLength={80} className="form-input w-full text-sm" placeholder="e.g. Suresh — tomorrow’s duties" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Description</label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={240} className="form-input w-full text-sm" placeholder="Who it is for and when to use it" />
                  </div>
                  <div className="-mx-3">
                    <Toggle on={shared} onChange={setShared} label={shared ? 'Shared with the team' : 'Only me'}
                      hint={shared ? 'Everyone with MC Report access can use it; only you can change it.' : 'Nobody else sees this template.'} />
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-0.5">
                    <p><strong>{config.columns.length}</strong> columns · {config.layout.orientation} {config.layout.paper} · grouped by {GROUP_BY_OPTIONS.find(g => g.key === config.layout.groupBy)?.label.toLowerCase()}</p>
                    <p><strong>{filterChips.length}</strong> filter{filterChips.length === 1 ? '' : 's'} · dates: {DATE_MODES.find(d => d.key === config.dateMode)?.label.toLowerCase()}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {active && !active.builtIn && active.canEdit && (
                      <button onClick={() => save(false)} disabled={busy === 'save'} className="btn btn-primary btn-sm justify-center">
                        {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Update “{active.name}”
                      </button>
                    )}
                    <button onClick={() => save(true)} disabled={busy === 'save'}
                      className={cn('btn btn-sm justify-center', active && !active.builtIn && active.canEdit ? 'btn-secondary' : 'btn-primary')}>
                      {active && !active.builtIn ? <Copy className="w-4 h-4" /> : <Save className="w-4 h-4" />} Save as new template
                    </button>
                    {active && !active.builtIn && active.canEdit && (
                      <button onClick={remove} disabled={busy === 'delete'} className="btn btn-sm justify-center text-rose-600 hover:bg-rose-50">
                        <Trash2 className="w-4 h-4" /> Delete template
                      </button>
                    )}
                    {active && !active.builtIn && !active.canEdit && (
                      <p className="text-[11px] text-slate-400 text-center">Shared by {active.ownerName ?? 'a teammate'} — save a copy to change it.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Preview ───────────────────────────────────────────────────── */}
          <section className="flex-1 min-w-0 flex flex-col bg-slate-200/70">
            <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-500">
              <span className="font-semibold uppercase tracking-wider text-[10px]">Live preview{rows.length > 250 ? ' · first 250 rows' : ''}</span>
              <button onClick={() => setBigPreview(v => !v)} className="flex items-center gap-1 hover:text-slate-800">
                {bigPreview ? <><Minimize2 className="w-3.5 h-3.5" /> Show editor</> : <><Maximize2 className="w-3.5 h-3.5" /> Focus preview</>}
              </button>
            </div>
            <div ref={frameBox} className="flex-1 min-h-0 overflow-auto px-1 pb-4">
              <div style={{ width: paperWidth * scale, height: frameHeight * scale, margin: '0 auto' }}>
                {/* Same-origin only so the frame can be measured; no scripts run in it. */}
                <iframe title="Report preview" srcDoc={previewHtml} sandbox="allow-same-origin"
                  onLoad={e => {
                    const doc = (e.currentTarget as HTMLIFrameElement).contentDocument
                    if (doc) setFrameHeight(Math.max(600, doc.documentElement.scrollHeight + 8))
                  }}
                  style={{ width: paperWidth, height: frameHeight, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', background: 'transparent' }} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
