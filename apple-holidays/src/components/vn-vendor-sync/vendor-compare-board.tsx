'use client'

/**
 * VN Vendor Sync — compare board. One row per upcoming movement the Excel has
 * an opinion on: what the EXCEL says, what the SYSTEM holds now, what it held
 * BEFORE, and WHO changed it. Each row can take the Excel value, be edited by
 * hand (directory search or free text), be reverted one step, or be ignored.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  FileSpreadsheet, Monitor, History, Loader2, Search, Check, Pencil, Undo2, EyeOff, Play, Wand2, X,
  Store, Car, Type, PlaneLanding, PlaneTakeoff, Hotel, MapPin, Equal, ArrowLeftRight, ChevronLeft, ChevronRight,
  Phone, Eraser, CheckSquare, Square, UserRound, Bot,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  EVENT_ACTION, LINK_STATUS, timeAgo, type CompareRow, type DirectoryHit,
} from '@/lib/vn-vendor-sync/shared'

type View = 'attention' | 'review' | 'manual' | 'applied' | 'ignored' | 'all'

const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: 'attention', label: 'Needs a look', hint: 'To review, kept yours, and vendors that left the Excel' },
  { key: 'review', label: 'To review', hint: 'Probable matches waiting for one click' },
  { key: 'manual', label: 'Different by hand', hint: 'The system holds a different vendor than the Excel' },
  { key: 'applied', label: 'Same as Excel', hint: 'Applied by the sync or already matching' },
  { key: 'ignored', label: 'Ignored', hint: 'The sync leaves these alone' },
  { key: 'all', label: 'All', hint: 'Every upcoming movement the Excel names a vendor for' },
]

function KindIcon({ kind }: { kind: string | null }) {
  const c = 'h-3 w-3'
  if (kind === 'AIRPORT_ARRIVAL') return <PlaneLanding className={c} />
  if (kind === 'AIRPORT_DEPARTURE') return <PlaneTakeoff className={c} />
  if (kind === 'HOTEL_MOVE') return <Hotel className={c} />
  return <MapPin className={c} />
}

function SourceBadge({ source }: { source: 'TOUR_VENDOR' | 'VEHICLE_VENDOR' | 'NONE' | null }) {
  if (source === 'TOUR_VENDOR') return <span title="In the Tour Vendor directory"><Store className="h-3 w-3 text-teal-600" /></span>
  if (source === 'VEHICLE_VENDOR') return <span title="Transport vendor (phone from there)"><Car className="h-3 w-3 text-sky-600" /></span>
  return <span title="Name only — not in the directory"><Type className="h-3 w-3 text-slate-400" /></span>
}

function Initials({ name }: { name: string }) {
  if (name === '—') return <span className="h-6 w-6 shrink-0" />
  const bot = /auto sync/i.test(name)
  const hand = /by hand/i.test(name)
  if (bot) return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700"><Bot className="h-3.5 w-3.5" /></span>
  if (hand) return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700"><UserRound className="h-3.5 w-3.5" /></span>
  const ini = name.replace(/\(.*\)/, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">{ini || '?'}</span>
}

// ── Inline editor ────────────────────────────────────────────────────────────

function Editor({ row, onDone, onCancel }: { row: CompareRow; onDone: () => void; onCancel: () => void }) {
  const [q, setQ] = useState(row.now?.name ?? '')
  const [picked, setPicked] = useState<DirectoryHit | null>(null)
  const [phone, setPhone] = useState(row.now?.phone ?? '')
  const [hits, setHits] = useState<DirectoryHit[]>([])
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/vn-vendor-sync/directory?q=${encodeURIComponent(picked ? '' : q)}`)
        const json = await res.json()
        if (json.success) setHits(json.data)
      } catch { /* ignore */ }
    }, 200)
    return () => clearTimeout(t)
  }, [q, picked])

  async function save(name: string | null, tourVendorId: string | null, ph: string | null) {
    setSaving(true)
    try {
      const res = await fetch('/api/vn-vendor-sync/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', linkId: row.linkId, name, tourVendorId, phone: ph, expected: row.now?.name ?? null }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.data.message)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(false) }
  }

  const quick = [
    row.excel.resolved && { label: 'Excel', value: row.excel.resolved, tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: <FileSpreadsheet className="h-3 w-3" /> },
    row.before.name && row.before.name !== row.now?.name && { label: 'Before', value: row.before.name, tone: 'bg-amber-50 text-amber-800 ring-amber-200', icon: <History className="h-3 w-3" /> },
  ].filter(Boolean) as { label: string; value: string; tone: string; icon: React.ReactNode }[]

  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-white p-3 shadow-inner">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Set tour vendor</span>
        {quick.map(c => (
          <button key={c.label} type="button" disabled={saving} onClick={() => { setQ(c.value); setPicked(null) }}
            className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 hover:shadow-sm', c.tone)}>
            {c.icon}{c.label}: {c.value}
          </button>
        ))}
        <button type="button" disabled={saving} onClick={() => { if (window.confirm('Clear the tour vendor on this movement? The sync will then leave it empty.')) void save(null, null, null) }}
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50">
          <Eraser className="h-3 w-3" /> Clear
        </button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input ref={inputRef} value={picked ? picked.name : q} onChange={e => { setQ(e.target.value); setPicked(null) }}
            onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && (picked || q.trim())) void save(picked?.name ?? q.trim(), picked?.source === 'TOUR_VENDOR' ? picked.id : null, phone.trim() || picked?.phone || null) }}
            placeholder="Search the directory or type a name"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        </div>
        <div className="relative">
          <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs focus:border-indigo-400 focus:outline-none" />
        </div>
        <div className="flex gap-1">
          <button type="button" disabled={saving || !(picked || q.trim())}
            onClick={() => save(picked?.name ?? q.trim(), picked?.source === 'TOUR_VENDOR' ? picked.id : null, phone.trim() || picked?.phone || null)}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg px-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      </div>
      {hits.length > 0 && !picked && (
        <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {hits.map(h => (
            <button key={`${h.source}:${h.id}`} type="button" onClick={() => { setPicked(h); if (!phone && h.phone) setPhone(h.phone) }}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] text-slate-700 ring-1 ring-slate-200 hover:ring-indigo-300">
              <SourceBadge source={h.source} />{h.name}{h.phone && <span className="text-slate-400">· {h.phone}</span>}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10.5px] text-slate-400">
        A value set here counts as set by hand — the sync will never overwrite it. It is logged, and Revert puts back {row.now?.name ? `"${row.now.name}"` : 'the empty value'}.
      </p>
    </div>
  )
}

// ── Board ────────────────────────────────────────────────────────────────────

export default function VendorCompareBoard({ runId, onChanged }: { runId?: string | null; onChanged?: () => void }) {
  const [view, setView] = useState<View>('attention')
  const [ref, setRef] = useState('')
  const [vendor, setVendor] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<CompareRow[]>([])
  const [total, setTotal] = useState(0)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const pageSize = 30

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ view: runId ? 'all' : view, page: String(page), pageSize: String(pageSize) })
    if (ref.trim()) sp.set('ref', ref.trim())
    if (vendor.trim()) sp.set('vendor', vendor.trim())
    if (runId) sp.set('runId', runId)
    try {
      const res = await fetch(`/api/vn-vendor-sync/compare?${sp}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.success) { setRows(json.data.rows); setTotal(json.data.total); setCanEdit(json.data.canEdit) }
      else toast.error(json.error)
    } finally { setLoading(false) }
  }, [view, page, ref, vendor, runId])

  useEffect(() => { const t = setTimeout(() => { void load() }, ref || vendor ? 300 : 0); return () => clearTimeout(t) }, [load, ref, vendor])
  useEffect(() => { setSelected(new Set()) }, [view, page, ref, vendor, runId])

  const after = async () => { setEditing(null); await load(); onChanged?.() }

  async function act(row: CompareRow, action: 'apply' | 'revert' | 'ignore' | 'resume') {
    if (action === 'apply' && row.now?.name && !row.same
      && !window.confirm(`Replace "${row.now.name}" with "${row.excel.resolved}" from the Excel?`)) return
    setBusy(row.linkId)
    try {
      const res = await fetch('/api/vn-vendor-sync/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, linkId: row.linkId }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.data.message)
      await after()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally { setBusy(null) }
  }

  async function bulkApply() {
    const ids = Array.from(selected)
    const replacing = rows.filter(r => selected.has(r.linkId) && r.now?.name && !r.same).length
    if (!window.confirm(`Use the Excel vendor on ${ids.length} movement(s)?${replacing ? `\n${replacing} of them have a different vendor set by hand, which will be replaced.` : ''}`)) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/vn-vendor-sync/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'applyMany', linkIds: ids }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.data.message)
      setSelected(new Set())
      await after()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally { setBulkBusy(false) }
  }

  const selectable = useMemo(() => rows.filter(r => !r.same && r.excel.resolved && r.status !== 'IGNORED'), [rows])
  const allPicked = selectable.length > 0 && selectable.every(r => selected.has(r.linkId))
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {/* Head */}
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-100 to-indigo-100"><ArrowLeftRight className="h-4 w-4 text-slate-700" /></span>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Excel ⇄ System</h2>
              <p className="text-[11px] text-slate-400">What the Excel says, what each movement holds now, what it held before — and who changed it</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={ref} onChange={e => { setRef(e.target.value); setPage(1) }} placeholder="Booking ref" className="w-32 rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs" />
            </div>
            <div className="relative">
              <Store className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={vendor} onChange={e => { setVendor(e.target.value); setPage(1) }} placeholder="Vendor" className="w-32 rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs" />
            </div>
          </div>
        </div>
        {runId ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-700 ring-1 ring-teal-200">
            Showing what one sweep wrote — click the sweep again to clear
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1">
            {VIEWS.map(v => (
              <button key={v.key} type="button" title={v.hint} onClick={() => { setView(v.key); setPage(1) }}
                className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium transition', view === v.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                {v.label}{view === v.key && <span className="ml-1 text-white/60 tabular-nums">{total}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk bar */}
      {canEdit && selected.size > 0 && (
        <div className="flex items-center gap-3 bg-emerald-600 px-4 py-2 text-xs text-white">
          <span className="font-semibold">{selected.size} selected</span>
          <button type="button" onClick={bulkApply} disabled={bulkBusy}
            className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
            {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Use Excel on all
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-white/80 hover:text-white">Clear</button>
        </div>
      )}

      {/* Column heads */}
      <div className="hidden grid-cols-[28px_150px_minmax(180px,1.2fr)_minmax(200px,1.2fr)_28px_minmax(170px,1fr)_minmax(120px,.8fr)_minmax(150px,.9fr)_170px] items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 xl:grid">
        <span>{canEdit && selectable.length > 0 && (
          <button type="button" onClick={() => setSelected(allPicked ? new Set() : new Set(selectable.map(r => r.linkId)))} aria-label="Select all">
            {allPicked ? <CheckSquare className="h-3.5 w-3.5 text-emerald-600" /> : <Square className="h-3.5 w-3.5" />}
          </button>
        )}</span>
        <span>Movement</span><span />
        <span className="flex items-center gap-1 text-emerald-700"><FileSpreadsheet className="h-3 w-3" />In the Excel</span>
        <span />
        <span className="flex items-center gap-1 text-slate-600"><Monitor className="h-3 w-3" />Now in the system</span>
        <span className="flex items-center gap-1 text-amber-700"><History className="h-3 w-3" />Before</span>
        <span>Changed by</span>
        <span className="text-right">Actions</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-slate-400">Nothing here{view === 'attention' ? ' — every upcoming movement agrees with the Excel or was decided by a person.' : '.'}</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map(r => {
            const st = LINK_STATUS[r.status]
            const pickable = canEdit && !r.same && Boolean(r.excel.resolved) && r.status !== 'IGNORED'
            const working = busy === r.linkId
            return (
              <li key={r.linkId} className={cn('px-4 py-3 transition', editing === r.linkId ? 'bg-indigo-50/30' : 'hover:bg-slate-50/60', r.status === 'IGNORED' && 'opacity-70')}>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[28px_150px_minmax(180px,1.2fr)_minmax(200px,1.2fr)_28px_minmax(170px,1fr)_minmax(120px,.8fr)_minmax(150px,.9fr)_170px] xl:items-start">
                  {/* select */}
                  <div className="hidden pt-1 xl:block">
                    {pickable && (
                      <button type="button" aria-label="Select" onClick={() => setSelected(s => { const n = new Set(s); if (n.has(r.linkId)) n.delete(r.linkId); else n.add(r.linkId); return n })}>
                        {selected.has(r.linkId) ? <CheckSquare className="h-3.5 w-3.5 text-emerald-600" /> : <Square className="h-3.5 w-3.5 text-slate-300" />}
                      </button>
                    )}
                  </div>

                  {/* date + booking */}
                  <div className="flex items-center gap-2 xl:block">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700">
                      {r.movementDate ? new Date(`${r.movementDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '—'}
                    </span>
                    <Link href={`/dashboard/bookings/${r.bookingRef}/agenda`} className="font-mono text-[11.5px] font-semibold text-teal-700 hover:underline xl:mt-1 xl:block">{r.bookingRef}</Link>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ring-1 xl:mt-1 xl:inline-block', st.pill)} title={st.hint}>{st.label}</span>
                  </div>

                  {/* movement */}
                  <div className="min-w-0">
                    <p className="flex items-start gap-1.5 text-[12px] font-medium leading-snug text-slate-800">
                      <span className="mt-0.5 text-slate-400"><KindIcon kind={r.movementKind} /></span>
                      <span className="line-clamp-2">{(r.movementLabel ?? '').replace(/^\d{4}-\d{2}-\d{2} · /, '')}</span>
                    </p>
                  </div>

                  {/* EXCEL */}
                  <div className="min-w-0 rounded-lg bg-emerald-50/60 px-2.5 py-2 ring-1 ring-emerald-100">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-900">
                      <span className="xl:hidden"><FileSpreadsheet className="h-3 w-3 text-emerald-600" /></span>
                      {r.excel.vendor ?? <span className="italic font-normal text-slate-400">no vendor</span>}
                      {r.excel.resolved && r.excel.vendor && r.excel.resolved !== r.excel.vendor && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><SourceBadge source={r.excel.source} />{r.excel.resolved}</span>
                      )}
                    </p>
                    {r.excel.line && (
                      <p className="mt-0.5 truncate text-[10.5px] text-emerald-800/70" title={`${r.excel.line}\n${r.excel.reason ?? ''}`}>
                        {r.excel.sheetRow && <span className="font-mono">row {r.excel.sheetRow} · </span>}{r.excel.code && <span className="font-semibold">{r.excel.code} · </span>}“{r.excel.line}”
                      </p>
                    )}
                    {r.excel.score !== null && (
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className="h-1 w-14 overflow-hidden rounded-full bg-emerald-100"><span className={cn('block h-full', r.excel.confidence === 'HIGH' ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${Math.round(r.excel.score * 100)}%` }} /></span>
                        <span className="text-[10px] tabular-nums text-emerald-700/70">{Math.round(r.excel.score * 100)}% match</span>
                      </span>
                    )}
                    {r.excel.also.length > 0 && <p className="mt-0.5 text-[10px] text-emerald-800/60">also: {r.excel.also.map(a => a.vendor).join(', ')}</p>}
                  </div>

                  {/* relation */}
                  <div className="hidden items-center justify-center pt-3 xl:flex">
                    {r.same
                      ? <span title="Same" className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Equal className="h-3.5 w-3.5" /></span>
                      : <span title="Different" className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">≠</span>}
                  </div>

                  {/* NOW */}
                  <div className={cn('min-w-0 rounded-lg px-2.5 py-2 ring-1', r.same ? 'bg-emerald-50/40 ring-emerald-100' : r.now?.name ? 'bg-violet-50/50 ring-violet-100' : 'bg-slate-50 ring-slate-100')}>
                    {r.now?.name ? (
                      <>
                        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-900">
                          <span className="xl:hidden"><Monitor className="h-3 w-3 text-slate-400" /></span>
                          {r.now.tourVendorId ? <Store className="h-3 w-3 text-teal-600" /> : <Type className="h-3 w-3 text-slate-400" />}{r.now.name}
                        </p>
                        {r.now.phone && <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-slate-500"><Phone className="h-2.5 w-2.5" />{r.now.phone}</p>}
                      </>
                    ) : <p className="text-[12px] italic text-slate-400">empty</p>}
                  </div>

                  {/* BEFORE */}
                  <div className="min-w-0 px-1 pt-2 text-[11.5px]">
                    <span className="mr-1 text-[10px] font-semibold uppercase text-amber-700 xl:hidden">Before:</span>
                    {r.before.from === 'UNKNOWN'
                      ? <span className="text-slate-300" title="No change recorded by the sync">—</span>
                      : r.before.name ? <span className="text-slate-500 line-through decoration-amber-300">{r.before.name}</span>
                        : <span className="italic text-slate-400">empty</span>}
                  </div>

                  {/* WHO */}
                  <div className="flex min-w-0 items-start gap-2 pt-1">
                    <Initials name={r.setBy} />
                    <div className="min-w-0">
                      <p className="truncate text-[11.5px] font-medium text-slate-700" title={r.setBy}>{r.setBy === '—' ? <span className="text-slate-300">—</span> : r.setBy}</p>
                      {r.lastChange && (
                        <p className="text-[10px] text-slate-400" title={new Date(r.lastChange.at).toLocaleString('en-GB')}>
                          <span className={cn('mr-1 rounded px-1 font-semibold ring-1', EVENT_ACTION[r.lastChange.action]?.tone)}>{EVENT_ACTION[r.lastChange.action]?.label}</span>
                          {timeAgo(r.lastChange.at)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* ACTIONS */}
                  <div className="flex flex-wrap items-center justify-start gap-1 xl:justify-end">
                    {working && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                    {canEdit && !working && (
                      <>
                        {!r.same && r.excel.resolved && r.status !== 'IGNORED' && (
                          <button type="button" onClick={() => act(r, 'apply')} title={`Set "${r.excel.resolved}" from the Excel`}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700">
                            <Wand2 className="h-3 w-3" /> Use Excel
                          </button>
                        )}
                        <button type="button" onClick={() => setEditing(e => (e === r.linkId ? null : r.linkId))} title="Type or pick a vendor"
                          className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium', editing === r.linkId ? 'bg-indigo-600 text-white' : 'text-indigo-700 hover:bg-indigo-50')}>
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        {r.canRevert && (
                          <button type="button" onClick={() => act(r, 'revert')} title={`Put back ${r.before.name ? `"${r.before.name}"` : 'the previous value'}`}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-orange-700 hover:bg-orange-50">
                            <Undo2 className="h-3 w-3" /> Revert
                          </button>
                        )}
                        {r.status === 'IGNORED'
                          ? <button type="button" onClick={() => act(r, 'resume')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-indigo-600 hover:bg-indigo-50"><Play className="h-3 w-3" /> Resume</button>
                          : !r.same && <button type="button" onClick={() => act(r, 'ignore')} title="The sync will leave this movement alone" className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><EyeOff className="h-3.5 w-3.5" /></button>}
                      </>
                    )}
                  </div>
                </div>
                {editing === r.linkId && (
                  <div className="mt-3 xl:ml-[190px]">
                    <Editor row={r} onDone={after} onCancel={() => setEditing(null)} />
                  </div>
                )}
                {r.note && editing !== r.linkId && <p className="mt-1 text-[10.5px] text-slate-400 xl:ml-[190px]">{r.note}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          Page {page} of {pages} · {total} movements
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </section>
  )
}
