'use client'

/**
 * Trans-Reconsultation — the half-month transport sheet each country desk kept
 * in Excel, built from the MC Report. See src/lib/trans-recon/shared.ts.
 *
 * Board: four countries × two halves of the chosen month.
 * Sheet: the lines, editable in place, saved together; Accounts approves them
 * from the Accounts system and their decision shows here.
 */
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, ArrowLeft, BarChart3, Building2, CalendarRange, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed,
  Download, Eye, EyeOff, FileSpreadsheet, Link2, Loader2, Lock, Plus, RefreshCw, RotateCcw, Save, Search, Send,
  Sparkles, Trash2, Undo2, Upload, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import Header from '@/components/layout/header'
import { ImportDialog } from '@/components/trans-recon/import-dialog'
import { PnlPicker, type PnlChoice } from '@/components/trans-recon/pnl-picker'
import { SupplierPicker, type PickedSupplier } from '@/components/suppliers/supplier-picker'
import { cn, readApiResponse } from '@/lib/utils'
import {
  NOT_INSTALLED, RECON_COUNTRIES, RECON_COUNTRY_META, RECON_CURRENCIES, breakdown, byBooking, byDay, bySupplier, byVendor,
  computeSheet, fmtMoney, parseRate, periodOf, sheetTitle, sortLines,
  type Breakdown, type EditableField, type Half, type LineFigures, type ReconCountry, type ReconLine,
  type ReconSheet, type SheetTotals,
} from '@/lib/trans-recon/shared'

// ── Types ───────────────────────────────────────────────────────────────────

interface BoardRow { sheet: ReconSheet; totals: SheetTotals }
interface BoardData { installed: boolean; allowed: ReconCountry[]; canEdit: boolean; sheets: BoardRow[] }
interface SheetData { sheet: ReconSheet; lines: ReconLine[]; canEdit?: boolean; partiesReady?: boolean }
type CustomPnl = { id: string; description: string; value: number; currency: string }

/** What the page holds for a line before Save. P&L preview fields are display only. */
type Edit = Partial<Record<EditableField, string | null>> & {
  pnlLineItemId?: string | null
  /** A P&L figure typed in the picker; saved as a typed P&L line. */
  pnlCustom?: CustomPnl
  _pnl?: { description: string | null; value: number | null; category: string | null; currency: string | null }
  /** The driver typed on the sheet. */
  driverName?: string | null
  /** The supplier picked on the sheet; null takes it off. */
  supplier?: PickedSupplier | null
}
type AddedLine = ReconLine & { tempId: string; pnlCustom?: CustomPnl }

const supplierOf = (l: ReconLine): PickedSupplier | null =>
  l.supplierSource && l.supplierId != null
    ? { source: l.supplierSource, id: l.supplierId, name: l.supplierName ?? '', country: l.supplierCountry ?? null }
    : null

/** Where a line's P&L came from, read off its id and match type. */
function pnlSource(l: Pick<ReconLine, 'pnlLineItemId' | 'pnlMatch'>): { label: string; cls: string; title: string } | null {
  const id = l.pnlLineItemId ?? ''
  if (!id) return null
  if (id.startsWith('custom:')) return { label: 'typed', cls: 'bg-amber-50 text-amber-700', title: 'P&L value typed on this sheet' }
  if (l.pnlMatch === 'EXCEL') return { label: 'from Excel', cls: 'bg-sky-50 text-sky-700', title: "Named in the DETAILS column of the desk's Excel" }
  const where = id.startsWith('acc:') ? 'Accounts P&L' : 'OPS P&L'
  if (l.pnlMatch === 'AUTO') return { label: `${where} · auto`, cls: 'bg-emerald-50 text-emerald-700', title: 'Paired automatically — open to confirm or change' }
  return { label: where, cls: 'bg-indigo-50 text-indigo-700', title: 'Picked on this sheet' }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const todayIso = () => new Date().toISOString().slice(0, 10)
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await readApiResponse<T>(res)
  if (!json.success) throw new Error(json.error || 'Request failed')
  return json.data as T
}

function StatusChip({ status, small }: { status: ReconSheet['status'] | 'NONE'; small?: boolean }) {
  const m = {
    NONE: { cls: 'bg-slate-100 text-slate-500', icon: CircleDashed, label: 'Not created' },
    DRAFT: { cls: 'bg-amber-50 text-amber-700 ring-amber-200', icon: CircleDashed, label: 'Draft' },
    SUBMITTED: { cls: 'bg-sky-50 text-sky-700 ring-sky-200', icon: Send, label: 'With Accounts' },
    LOCKED: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: Lock, label: 'Locked' },
  }[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-transparent', small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs', m.cls)}>
      <m.icon className={small ? 'w-3 h-3' : 'w-3.5 h-3.5'} /> {m.label}
    </span>
  )
}

function ApprovalChip({ line }: { line: ReconLine }) {
  if (line.bookingCancelled) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">CANCELLED</span>
  const m = {
    PENDING: { cls: 'bg-slate-100 text-slate-500', icon: CircleDashed, label: 'Pending' },
    APPROVED: { cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', icon: CheckCircle2, label: 'Approved' },
    REJECTED: { cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200', icon: XCircle, label: 'Not approved' },
  }[line.approvalStatus]
  return (
    <span title={[line.approvedByName && `${line.approvalStatus === 'PENDING' ? '' : 'By '}${line.approvedByName}`, line.approvalNote].filter(Boolean).join(' — ') || undefined}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap', m.cls)}>
      <m.icon className="w-3 h-3" /> {m.label}
    </span>
  )
}

function Diff({ f, currency }: { f: LineFigures | undefined; currency: string }) {
  if (!f) return null
  if (f.gap === 'NO_RATE') return <span className="text-[11px] text-slate-300">—</span>
  if (f.gap === 'NO_PNL') return <span className="text-[10px] font-semibold text-slate-400">no P&amp;L</span>
  if (f.gap === 'NO_FX') return <span className="text-[10px] font-semibold text-amber-600" title="Set the exchange rate for this P&L currency above">needs FX</span>
  const d = f.difference ?? 0
  if (Math.abs(d) < 0.005) return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><Check className="w-3 h-3" />0</span>
  return <span className={cn('text-xs font-bold tabular-nums', d > 0 ? 'text-rose-600' : 'text-emerald-600')}>{d > 0 ? '+' : ''}{fmtMoney(d, currency)}</span>
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function TransReconsultationPage() {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}>
      <TransReconsultation />
    </Suspense>
  )
}

function TransReconsultation() {
  const params = useSearchParams()
  const router = useRouter()
  const sheetId = params.get('sheet')
  return sheetId
    ? <SheetEditor id={sheetId} onBack={() => router.push('/dashboard/trans-reconsultation')} />
    : <Board onOpen={id => router.push(`/dashboard/trans-reconsultation?sheet=${id}`)} />
}

// ── Board ───────────────────────────────────────────────────────────────────

function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 })
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api<BoardData>(`/api/trans-recon?year=${ym.y}&month=${ym.m}`)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [ym])
  useEffect(() => { load() }, [load])

  const shift = (d: number) => setYm(({ y, m }) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 } })

  const generate = async (country: ReconCountry, half: Half) => {
    const key = `${country}-${half}`
    setBusy(key)
    try {
      const out = await api<{ id: string; created: boolean; sync: { added: number; unplaced: number } | null }>('/api/trans-recon', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country, year: ym.y, month: ym.m, half }),
      })
      if (out.created) toast.success(`Sheet generated — ${out.sync?.added ?? 0} MC lines`)
      onOpen(out.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate')
    } finally { setBusy(null) }
  }

  const sheets = data?.sheets ?? []
  const month = sheets.reduce((a, r) => {
    a.lines += r.totals.lines; a.pending += r.totals.pending; a.approved += r.totals.approved; a.rejected += r.totals.rejected
    a.over += r.totals.over; a.noPnl += r.totals.lines - r.totals.matched; a.noRate += r.totals.lines - r.totals.rated
    return a
  }, { lines: 0, pending: 0, approved: 0, rejected: 0, over: 0, noPnl: 0, noRate: 0 })
  const countries = data?.allowed ?? []

  return (
    <>
      <Header title="Trans-Reconsultation" subtitle="Half-month transport sheets per country — built from the MC Report, checked against the P&L, approved by Accounts" />
      <div className="px-4 py-5 sm:px-8 sm:py-6 space-y-5">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-900 to-emerald-800 p-5 text-white shadow-lg">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="absolute left-1/3 -bottom-28 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button onClick={() => shift(-1)} className="rounded-lg bg-white/10 p-2 ring-1 ring-white/20 hover:bg-white/20" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/60">Period</div>
                <div className="text-2xl font-bold tracking-tight">{new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
              </div>
              <button onClick={() => shift(1)} className="rounded-lg bg-white/10 p-2 ring-1 ring-white/20 hover:bg-white/20" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
              {data?.canEdit && data.installed && (
                <button onClick={() => setImporting(true)}
                  className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-emerald-950 shadow hover:bg-emerald-300">
                  <Upload className="h-3.5 w-3.5" /> Import Excel
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                ['Lines', month.lines], ['Pending', month.pending], ['Approved', month.approved],
                ['Not approved', month.rejected], ['Over P&L', month.over], ['No rate yet', month.noRate],
              ].map(([l, v]) => (
                <div key={String(l)} className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15 backdrop-blur">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-white/60">{l}</div>
                  <div className="text-lg font-bold tabular-nums">{loading ? '…' : v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {data && !data.installed && (
          <div className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {NOT_INSTALLED}
          </div>
        )}
        {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div>}

        <div className="grid gap-4 md:grid-cols-2">
          {(loading && !data ? RECON_COUNTRIES : countries).map(country => (
            <div key={country} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{RECON_COUNTRY_META[country].flag}</span>
                  <div>
                    <div className="font-bold text-slate-800">{RECON_COUNTRY_META[country].label}</div>
                    <div className="text-[11px] text-slate-400">Rates in {RECON_COUNTRY_META[country].currency} by default</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([1, 2] as Half[]).map(half => {
                  const row = sheets.find(r => r.sheet.country === country && r.sheet.half === half)
                  const p = periodOf(ym.y, ym.m, half)
                  const t = row?.totals
                  const decided = t ? t.approved + t.rejected : 0
                  const key = `${country}-${half}`
                  return (
                    <div key={half} className={cn('group rounded-xl p-3 ring-1 transition', row ? 'cursor-pointer bg-slate-50/60 ring-slate-200 hover:bg-indigo-50/40 hover:ring-indigo-200' : 'bg-white ring-dashed ring-slate-200')}
                      onClick={() => row && onOpen(row.sheet.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-slate-700">{Number(p.start.slice(8))}–{Number(p.end.slice(8))} {MONTHS[ym.m - 1]}</div>
                          <div className="mt-1"><StatusChip status={row?.sheet.status ?? 'NONE'} small /></div>
                        </div>
                        {row && <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500" />}
                      </div>
                      {row && t ? (
                        <div className="mt-3 space-y-1.5 text-[11px] text-slate-500">
                          <div className="flex justify-between"><span>{t.lines} lines</span><span className="font-semibold text-slate-700 tabular-nums">{fmtMoney(t.totalRate, row.sheet.currency)}</span></div>
                          <div className="flex justify-between"><span>vs P&amp;L</span>
                            <span className={cn('font-semibold tabular-nums', t.difference > 0.005 ? 'text-rose-600' : t.difference < -0.005 ? 'text-emerald-600' : 'text-slate-500')}>
                              {t.difference > 0 ? '+' : ''}{fmtMoney(t.difference, row.sheet.currency)}
                            </span>
                          </div>
                          <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-200">
                            <div className="bg-emerald-500" style={{ width: `${t.lines ? (t.approved / t.lines) * 100 : 0}%` }} />
                            <div className="bg-rose-500" style={{ width: `${t.lines ? (t.rejected / t.lines) * 100 : 0}%` }} />
                          </div>
                          <div className="text-[10px]">{decided}/{t.lines} decided by Accounts{t.lines - t.rated > 0 ? ` · ${t.lines - t.rated} without a rate` : ''}</div>
                        </div>
                      ) : (
                        <div className="mt-3">
                          {data?.canEdit && data.installed ? (
                            <button disabled={busy === key} onClick={e => { e.stopPropagation(); generate(country, half) }}
                              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60">
                              {busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Generate from MC
                            </button>
                          ) : <div className="text-[11px] text-slate-400">No sheet yet.</div>}
                          <div className="mt-1.5 text-center text-[10px] text-slate-400">{sheetTitle(country, p)}</div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {data && !countries.length && <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">Your account is not assigned to Malaysia, Singapore, Vietnam or Sri Lanka.</div>}
      </div>
      <ImportDialog open={importing} onClose={() => setImporting(false)} allowed={countries} onDone={onOpen} />
    </>
  )
}

// ── Sheet editor ────────────────────────────────────────────────────────────

type Filter = 'ALL' | 'NO_RATE' | 'NO_PNL' | 'OVER' | 'REJECTED' | 'PENDING' | 'MANUAL' | 'NO_SUPPLIER'

const CELL = 'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs text-slate-700 outline-none hover:border-slate-200 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 disabled:hover:border-transparent'

function SheetEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<SheetData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [added, setAdded] = useState<AddedLine[]>([])
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [restored, setRestored] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'save' | 'sync' | 'submit' | 'header' | null>(null)
  const [tab, setTab] = useState<'sheet' | 'report'>('sheet')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('ALL')
  const [showCancelled, setShowCancelled] = useState(false)
  const [showRemoved, setShowRemoved] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [picker, setPicker] = useState<string | null>(null)
  const [supplierPicker, setSupplierPicker] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const tempSeq = useRef(0)

  const apply = useCallback((d: SheetData) => {
    setData(prev => ({ ...d, canEdit: d.canEdit ?? prev?.canEdit }))
    setEdits({}); setAdded([]); setRemoved(new Set()); setRestored(new Set())
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { apply(await api<SheetData>(`/api/trans-recon/${id}`)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [id, apply])
  useEffect(() => { load() }, [load])

  const dirty = Object.keys(edits).length + added.length + removed.size + restored.size
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const sheet = data?.sheet
  const locked = sheet?.status === 'LOCKED'
  const editable = Boolean(data?.canEdit) && !locked

  // The lines as they will be after Save — what the figures are computed on.
  const effective = useMemo<ReconLine[]>(() => {
    if (!data) return []
    const merged = data.lines.map(l => {
      const e = edits[l.id]
      let out: ReconLine = l
      if (e) {
        const { _pnl, pnlLineItemId, pnlCustom: _custom, supplier, ...fields } = e
        out = { ...l, ...fields } as ReconLine
        if (supplier !== undefined) {
          out.supplierSource = supplier?.source ?? null
          out.supplierId = supplier?.id ?? null
          out.supplierName = supplier?.name ?? null
          out.supplierCountry = supplier?.country ?? null
        }
        if ('rateText' in e) out.rate = parseRate(e.rateText)
        if (pnlLineItemId !== undefined) {
          out.pnlLineItemId = pnlLineItemId
          out.pnlDescription = _pnl?.description ?? null
          out.pnlValue = _pnl?.value ?? null
          out.pnlCategory = _pnl?.category ?? null
          out.pnlCurrency = _pnl?.currency ?? null
          out.pnlMatch = 'MANUAL'
        }
      }
      if (removed.has(l.id)) out = { ...out, isRemoved: true }
      if (restored.has(l.id)) out = { ...out, isRemoved: false }
      return out
    })
    return sortLines([...merged, ...added.map(a => ({ ...a, rate: parseRate(a.rateText) }))])
  }, [data, edits, added, removed, restored])

  const { figures, totals } = useMemo(
    () => computeSheet(effective, sheet?.currency ?? 'USD', sheet?.fxRates ?? {}),
    [effective, sheet?.currency, sheet?.fxRates],
  )

  const foreignCurrencies = useMemo(() => {
    const set = new Set<string>()
    for (const l of effective) if (l.pnlCurrency && sheet && l.pnlCurrency.toUpperCase() !== sheet.currency.toUpperCase()) set.add(l.pnlCurrency.toUpperCase())
    return Array.from(set).sort()
  }, [effective, sheet])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return effective.filter(l => {
      if (l.isRemoved && !showRemoved) return false
      if (l.bookingCancelled && !showCancelled) return false
      const f = figures.get(l.id)
      switch (filter) {
        case 'NO_RATE': if (l.rate != null) return false; break
        case 'NO_PNL': if (l.pnlValue != null) return false; break
        case 'OVER': if (!f || f.difference == null || f.difference <= 0.005) return false; break
        case 'REJECTED': if (l.approvalStatus !== 'REJECTED') return false; break
        case 'PENDING': if (l.approvalStatus !== 'PENDING') return false; break
        case 'MANUAL': if (l.source !== 'MANUAL') return false; break
        case 'NO_SUPPLIER': if (l.supplierId != null) return false; break
      }
      if (!needle) return true
      return [l.tourNo, l.guestName, l.pickUp, l.dropOff, l.details, l.mcDescription, l.pnlDescription, l.vendorName, l.rateText, l.driverName, l.supplierName]
        .some(v => String(v ?? '').toLowerCase().includes(needle))
    })
  }, [effective, q, filter, showCancelled, showRemoved, figures])

  const counts = useMemo(() => {
    const live = effective.filter(l => !l.isRemoved && !l.bookingCancelled)
    return {
      ALL: live.length,
      NO_RATE: live.filter(l => l.rate == null).length,
      NO_PNL: live.filter(l => l.pnlValue == null).length,
      OVER: live.filter(l => (figures.get(l.id)?.difference ?? 0) > 0.005).length,
      REJECTED: live.filter(l => l.approvalStatus === 'REJECTED').length,
      PENDING: live.filter(l => l.approvalStatus === 'PENDING').length,
      MANUAL: live.filter(l => l.source === 'MANUAL').length,
      NO_SUPPLIER: live.filter(l => l.supplierId == null).length,
    }
  }, [effective, figures])

  // ── edits ──
  const isAdded = (lineId: string) => lineId.startsWith('tmp_')
  const setField = (line: ReconLine, field: EditableField, value: string) => {
    if (isAdded(line.id)) {
      setAdded(a => a.map(r => r.id === line.id ? { ...r, [field]: value } : r))
      return
    }
    const original = data!.lines.find(l => l.id === line.id)!
    setEdits(prev => {
      const next = { ...prev }
      const e: Edit = { ...(next[line.id] ?? {}) }
      const orig = (original as unknown as Record<string, string | null>)[field] ?? ''
      if ((value ?? '') === (orig ?? '')) delete e[field]
      else e[field] = value
      if (Object.keys(e).length) next[line.id] = e; else delete next[line.id]
      return next
    })
  }
  /**
   * Apply a picker choice to a line and any lines ticked "use for these too".
   * A typed figure gets one id for all of them, so they split it like a
   * shared P&L line rather than each counting it in full.
   */
  const setPnl = (lineIds: string[], choice: PnlChoice) => {
    const custom: CustomPnl | undefined = choice?.kind === 'custom'
      ? { id: `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, description: choice.description, value: choice.value, currency: choice.currency }
      : undefined
    const pnlId = choice ? (custom ? custom.id : (choice as { id: string }).id) : null
    const preview = {
      description: custom ? custom.description : choice?.kind === 'line' ? choice.activity : null,
      value: choice ? choice.value : null,
      category: custom ? 'CUSTOM' : choice?.kind === 'line' ? choice.category : null,
      currency: choice ? choice.currency : null,
    }
    const ids = new Set(lineIds)
    setAdded(a => a.map(r => !ids.has(r.id) ? r : {
      ...r, pnlLineItemId: pnlId, pnlDescription: preview.description, pnlValue: preview.value, pnlCategory: preview.category,
      pnlCurrency: preview.currency, pnlMatch: choice ? 'MANUAL' : 'NONE', pnlCustom: custom,
    }))
    setEdits(prev => {
      const next = { ...prev }
      for (const lid of lineIds) {
        if (isAdded(lid)) continue
        const { pnlCustom: _old, ...rest } = next[lid] ?? {}
        next[lid] = { ...rest, pnlLineItemId: pnlId ?? '', _pnl: preview, ...(custom ? { pnlCustom: custom } : {}) }
      }
      return next
    })
    setPicker(null)
    if (lineIds.length > 1) toast.message(`P&L line set on ${lineIds.length} lines — they share its value. Save to keep it.`)
  }
  /** The driver typed on a line — saved with the sheet; a refresh then leaves it alone. */
  const setDriver = (line: ReconLine, value: string) => {
    if (isAdded(line.id)) { setAdded(a => a.map(r => r.id === line.id ? { ...r, driverName: value } : r)); return }
    const orig = data!.lines.find(l => l.id === line.id)!.driverName ?? ''
    setEdits(prev => {
      const next = { ...prev }
      const e: Edit = { ...(next[line.id] ?? {}) }
      if (value === orig) delete e.driverName; else e.driverName = value
      if (Object.keys(e).length) next[line.id] = e; else delete next[line.id]
      return next
    })
  }
  /** A supplier picked for a line and any lines ticked "also set on". */
  const setSupplier = (lineIds: string[], supplier: PickedSupplier | null) => {
    const ids = new Set(lineIds)
    setAdded(a => a.map(r => !ids.has(r.id) ? r : {
      ...r, supplierSource: supplier?.source ?? null, supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? null, supplierCountry: supplier?.country ?? null,
    }))
    setEdits(prev => {
      const next = { ...prev }
      for (const lid of lineIds) {
        if (isAdded(lid)) continue
        const orig = supplierOf(data!.lines.find(l => l.id === lid)!)
        const e: Edit = { ...(next[lid] ?? {}) }
        if ((orig?.source ?? null) === (supplier?.source ?? null) && (orig?.id ?? null) === (supplier?.id ?? null)) delete e.supplier
        else e.supplier = supplier
        if (Object.keys(e).length) next[lid] = e; else delete next[lid]
      }
      return next
    })
    setSupplierPicker(null)
    if (lineIds.length > 1) toast.message(`Supplier set on ${lineIds.length} lines. Save to keep it.`)
  }
  const addRow = (date?: string) => {
    if (!sheet) return
    const d = date && date >= sheet.periodStart && date <= sheet.periodEnd ? date
      : todayIso() >= sheet.periodStart && todayIso() <= sheet.periodEnd ? todayIso() : sheet.periodStart
    const tempId = `tmp_${++tempSeq.current}`
    setAdded(a => [...a, {
      id: tempId, tempId, position: 1e9 + tempSeq.current, source: 'MANUAL', agendaItemId: null, bookingRef: null,
      serviceDate: d, tourNo: '', guestName: '', pax: '', pickUp: '', dropOff: '', time: '', details: '',
      mcDescription: null, serviceType: null, vendorName: null, mcDriverRate: null, mcRateCurrency: null,
      pnlLineItemId: null, pnlDescription: null, pnlCategory: null, pnlValue: null, pnlCurrency: null, pnlMatch: 'NONE',
      pnlScore: null, rateText: '', rate: null, remarks: '', editedFields: [], bookingCancelled: false, mcMissing: false,
      isRemoved: false, approvalStatus: 'PENDING', approvalNote: null, approvedRate: null, approvedByName: null,
      approvedAt: null, importedFrom: null, importRow: null, updatedByName: null, updatedAt: null,
    }])
    setExpanded(null)
  }
  const removeRow = (line: ReconLine) => {
    if (isAdded(line.id)) { setAdded(a => a.filter(r => r.id !== line.id)); return }
    setRestored(s => { const n = new Set(s); n.delete(line.id); return n })
    setRemoved(s => new Set(s).add(line.id))
  }
  const restoreRow = (line: ReconLine) => {
    setRemoved(s => { const n = new Set(s); n.delete(line.id); return n })
    if (data?.lines.find(l => l.id === line.id)?.isRemoved) setRestored(s => new Set(s).add(line.id))
  }
  const discard = () => { setEdits({}); setAdded([]); setRemoved(new Set()); setRestored(new Set()) }

  const save = async () => {
    if (!dirty) return
    setBusy('save')
    try {
      const lines = [
        ...Object.entries(edits).map(([lid, e]) => {
          const { _pnl: _ignored, pnlCustom, pnlLineItemId, supplier, ...rest } = e
          // A typed figure travels as pnlCustom; its id only groups the preview.
          return {
            id: lid, ...rest, ...(pnlCustom ? { pnlCustom } : pnlLineItemId !== undefined ? { pnlLineItemId } : {}),
            ...(supplier !== undefined ? { supplier: supplier ? { source: supplier.source, id: supplier.id } : null } : {}),
          }
        }),
        ...added.map(a => ({
          tempId: a.tempId, serviceDate: a.serviceDate, tourNo: a.tourNo, guestName: a.guestName, pax: a.pax,
          pickUp: a.pickUp, dropOff: a.dropOff, time: a.time, details: a.details, rateText: a.rateText,
          remarks: a.remarks, ...(a.pnlCustom ? { pnlCustom: a.pnlCustom } : { pnlLineItemId: a.pnlLineItemId }),
          ...(data?.partiesReady && (a.driverName || a.supplierId != null) ? {
            driverName: a.driverName ?? null,
            supplier: a.supplierSource && a.supplierId != null ? { source: a.supplierSource, id: a.supplierId } : null,
          } : {}),
        })),
      ]
      const out = await api<SheetData & { saved: number }>(`/api/trans-recon/${id}/lines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, remove: Array.from(removed), restore: Array.from(restored) }),
      })
      apply(out)
      toast.success('Sheet saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally { setBusy(null) }
  }

  const sync = async () => {
    if (dirty && !confirm('Save your changes first? Refreshing now discards the unsaved edits.')) return
    setBusy('sync')
    try {
      const out = await api<SheetData & { result: { added: number; updated: number; cancelled: number; missing: number; unplaced: number; repaired: number; suppliers?: number } }>(`/api/trans-recon/${id}/sync`, { method: 'POST' })
      apply(out)
      const r = out.result
      toast.success(`Refreshed from MC — ${r.added} new, ${r.updated} checked${r.cancelled ? `, ${r.cancelled} now cancelled` : ''}${r.missing ? `, ${r.missing} no longer on the chart` : ''}${r.suppliers ? `, ${r.suppliers} supplier${r.suppliers === 1 ? '' : 's'} from MC` : ''}`)
      if (r.unplaced) toast.message(`${r.unplaced} Singapore/Malaysia movement${r.unplaced === 1 ? '' : 's'} could not be placed in a country — check their location on the agenda.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not refresh')
    } finally { setBusy(null) }
  }

  const patchSheet = async (body: Record<string, unknown>, kind: 'header' | 'submit' = 'header') => {
    setBusy(kind)
    try {
      const out = await api<SheetData>(`/api/trans-recon/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      // Header changes keep the unsaved line edits.
      setData(prev => prev ? { ...prev, sheet: out.sheet } : out)
      if (body.action === 'SUBMIT') toast.success('Sent to Accounts for approval')
      if (body.action === 'RECALL') toast.success('Back in draft')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update')
    } finally { setBusy(null) }
  }

  const refOf = (line: ReconLine) => line.bookingRef || (isAdded(line.id) ? String(line.tourNo ?? '').trim() : '')
  const openPicker = (line: ReconLine) => {
    if (!refOf(line)) { toast.message('Type the tour number first — the P&L is looked up by it.'); return }
    setPicker(line.id)
  }

  /** Pair every line with no P&L against its booking's Accounts P&L, in one go. */
  const pairAccounts = async () => {
    if (dirty) { toast.message('Save your changes first.'); return }
    setBusy('sync')
    try {
      const out = await api<SheetData & { result: { paired: number; bookings: number; noAccountsPnl: string[] } }>(`/api/trans-recon/${id}/pair-accounts`, { method: 'POST' })
      apply(out)
      const r = out.result
      toast.success(`${r.paired} line${r.paired === 1 ? '' : 's'} paired from the Accounts P&L`)
      if (r.noAccountsPnl.length) toast.message(`No Accounts P&L for ${r.noAccountsPnl.slice(0, 6).join(', ')}${r.noAccountsPnl.length > 6 ? '…' : ''} — pick or type those by hand.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not pair')
    } finally { setBusy(null) }
  }

  if (loading && !data) {
    return <><Header title="Trans-Reconsultation" /><div className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading sheet…</div></>
  }
  if (error || !data || !sheet) {
    return (
      <>
        <Header title="Trans-Reconsultation" />
        <div className="space-y-3 p-8">
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{error ?? 'Sheet not found'}</div>
          <button onClick={onBack} className="text-sm font-semibold text-indigo-600">← Back to the board</button>
        </div>
      </>
    )
  }

  const cur = sheet.currency
  const FILTERS: { key: Filter; label: string; tone?: string }[] = [
    { key: 'ALL', label: 'All' }, { key: 'NO_RATE', label: 'No rate', tone: 'amber' }, { key: 'NO_PNL', label: 'No P&L line' },
    { key: 'OVER', label: 'Over P&L', tone: 'rose' }, { key: 'PENDING', label: 'Pending' }, { key: 'REJECTED', label: 'Not approved', tone: 'rose' },
    { key: 'MANUAL', label: 'Added by hand' },
    ...(data.partiesReady ? [{ key: 'NO_SUPPLIER' as Filter, label: 'No supplier', tone: 'amber' }] : []),
  ]
  let lastDay = ''
  // Driver / Supplier is one extra column once trans_recon_line_parties exists.
  const parties = Boolean(data.partiesReady)
  const COLS = ['Date', 'Tour no', ...(parties ? ['Driver · Supplier'] : []), 'Guest name', 'Pax', 'Pick up', 'Drop off', 'Time', 'Details', 'MC description', 'P&L description', `Rates (${cur})`, `P&L rate`, 'Difference', 'Accounts', '']
  const firstMoney = COLS.indexOf(`Rates (${cur})`)

  return (
    <>
      <Header title="Trans-Reconsultation" subtitle={sheet.title} />
      <div className="space-y-4 px-4 py-5 sm:px-8 sm:py-6">
        {/* Title bar */}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { if (!dirty || confirm('Leave without saving your changes?')) onBack() }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
            <ArrowLeft className="h-3.5 w-3.5" /> Board
          </button>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{RECON_COUNTRY_META[sheet.country].flag}</span>
            <div>
              <div className="text-lg font-bold leading-tight text-slate-800">{sheet.title}</div>
              <div className="text-[11px] text-slate-400">
                {sheet.lastSyncedAt ? `MC refreshed ${new Date(sheet.lastSyncedAt).toLocaleString('en-GB')}` : 'Never refreshed'}
                {sheet.submittedAt ? ` · sent to Accounts by ${sheet.submittedByName ?? '—'} ${new Date(sheet.submittedAt).toLocaleDateString('en-GB')}` : ''}
                {sheet.lockedAt ? ` · locked by ${sheet.lockedByName ?? 'Accounts'}` : ''}
                {sheet.lastImportFile ? ` · Excel “${sheet.lastImportFile}” imported${sheet.lastImportBy ? ` by ${sheet.lastImportBy}` : ''}${sheet.lastImportAt ? ` ${new Date(sheet.lastImportAt).toLocaleDateString('en-GB')}` : ''}` : ''}
              </div>
            </div>
            <StatusChip status={sheet.status} />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {editable && (
              <button onClick={() => { if (dirty) { toast.message('Save your changes before importing.'); return } setImporting(true) }} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-50">
                <Upload className="h-3.5 w-3.5" /> Import Excel
              </button>
            )}
            {editable && counts.NO_PNL > 0 && (
              <button onClick={pairAccounts} disabled={busy !== null} title="Pair every line that has no P&L with its booking's Accounts (Detailed) P&L"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 disabled:opacity-50">
                <Sparkles className="h-3.5 w-3.5" /> Pair {counts.NO_PNL} from Accounts P&amp;L
              </button>
            )}
            {editable && (
              <button onClick={sync} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
                {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh from MC
              </button>
            )}
            <a href={`/api/trans-recon/${id}/export${showCancelled ? '?cancelled=1' : ''}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">
              <Download className="h-3.5 w-3.5" /> Excel + report
            </a>
            {editable && sheet.status === 'DRAFT' && (
              <button onClick={() => { if (dirty) { toast.message('Save your changes before sending the sheet.'); return } patchSheet({ action: 'SUBMIT' }, 'submit') }} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50">
                {busy === 'submit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send to Accounts
              </button>
            )}
            {editable && sheet.status === 'SUBMITTED' && (
              <button onClick={() => patchSheet({ action: 'RECALL' }, 'submit')} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
                <Undo2 className="h-3.5 w-3.5" /> Back to draft
              </button>
            )}
          </div>
        </div>

        {locked && (
          <div className="flex gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" /> Accounts locked this sheet{sheet.lockedByName ? ` (${sheet.lockedByName})` : ''}. It is read-only here until they unlock it.
          </div>
        )}
        {sheet.accountsNote && (
          <div className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800 ring-1 ring-sky-200"><b>Accounts:</b> {sheet.accountsNote}</div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {[
            { l: 'Lines', v: String(totals.lines), s: `${totals.cancelled} cancelled hidden` },
            { l: 'Total rate', v: fmtMoney(totals.totalRate, cur), s: `${totals.rated}/${totals.lines} rated` },
            { l: 'Total P&L', v: fmtMoney(totals.totalPnl, cur), s: `${totals.matched}/${totals.lines} paired` },
            { l: 'Difference', v: `${totals.difference > 0 ? '+' : ''}${fmtMoney(totals.difference, cur)}`, s: 'rate − P&L, paired lines', tone: totals.difference > 0.005 ? 'rose' : totals.difference < -0.005 ? 'emerald' : '' },
            { l: 'Over / under', v: `${totals.over} / ${totals.under}`, s: 'lines vs their P&L' },
            { l: 'Unpaired rate', v: fmtMoney(totals.unmatchedRate, cur), s: 'no P&L to compare' },
            { l: 'Approved', v: `${totals.approved}`, s: fmtMoney(totals.approvedRate, cur), tone: 'emerald' },
            { l: 'Pending / not', v: `${totals.pending} / ${totals.rejected}`, s: 'with Accounts', tone: totals.rejected ? 'rose' : '' },
          ].map(k => (
            <div key={k.l} className="rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{k.l}</div>
              <div className={cn('truncate text-base font-bold tabular-nums', k.tone === 'rose' ? 'text-rose-600' : k.tone === 'emerald' ? 'text-emerald-600' : 'text-slate-800')}>{k.v}</div>
              <div className="truncate text-[10px] text-slate-400">{k.s}</div>
            </div>
          ))}
        </div>

        {/* Currency + FX */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 text-xs shadow-sm ring-1 ring-slate-200">
          <label className="flex items-center gap-2 font-semibold text-slate-600">
            Sheet currency
            <select disabled={!editable || busy !== null} value={cur} onChange={e => patchSheet({ currency: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold">
              {Array.from(new Set([cur, ...RECON_CURRENCIES])).map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          {foreignCurrencies.length > 0 && <span className="text-slate-300">|</span>}
          {foreignCurrencies.map(c => (
            <FxInput key={c} sheetId={id} from={c} to={cur} value={sheet.fxRates[c]} disabled={!editable || busy !== null}
              onSave={v => patchSheet({ fxRates: { ...sheet.fxRates, [c]: v } })} />
          ))}
          {foreignCurrencies.length > 0 && <span className="text-[11px] text-slate-400">P&amp;L lines are converted at these rates before the difference is taken.</span>}
        </div>

        {/* Tabs + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-white p-0.5 ring-1 ring-slate-200">
            {([['sheet', 'Sheet', FileSpreadsheet], ['report', 'Report', BarChart3]] as const).map(([k, l, I]) => (
              <button key={k} onClick={() => setTab(k)} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold', tab === k ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-50')}>
                <I className="h-3.5 w-3.5" /> {l}
              </button>
            ))}
          </div>
          {tab === 'sheet' && (
            <>
              <div className="flex min-w-[200px] max-w-sm flex-1 items-center gap-2 rounded-xl bg-white px-3 py-1.5 ring-1 ring-slate-200">
                <Search className="h-4 w-4 text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tour no, guest, place, vendor…" className="flex-1 bg-transparent text-sm outline-none" />
              </div>
              <button onClick={() => setShowCancelled(v => !v)} className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1', showCancelled ? 'bg-rose-600 text-white ring-rose-600' : 'bg-white text-slate-600 ring-slate-200')}>
                {showCancelled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} Cancelled {totals.cancelled}
              </button>
              <button onClick={() => setShowRemoved(v => !v)} className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1', showRemoved ? 'bg-slate-700 text-white ring-slate-700' : 'bg-white text-slate-600 ring-slate-200')}>
                {showRemoved ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} Removed {effective.filter(l => l.isRemoved).length}
              </button>
            </>
          )}
        </div>
        {tab === 'sheet' && (
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={cn('rounded-full px-3 py-1 text-xs font-semibold ring-1 transition',
                  filter === f.key ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300',
                  filter !== f.key && f.tone === 'rose' && counts[f.key] > 0 && 'text-rose-600 ring-rose-200',
                  filter !== f.key && f.tone === 'amber' && counts[f.key] > 0 && 'text-amber-700 ring-amber-200')}>
                {f.label} <span className="ml-0.5 opacity-60">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'report' ? (
          <Report lines={effective} figures={figures} currency={cur} />
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[1680px] border-collapse text-xs">
                <thead className="sticky top-0 z-20 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    {COLS.map((h, i) => (
                      <th key={i} className={cn('border-b border-slate-200 px-2 py-2.5 text-left whitespace-nowrap', i >= firstMoney && i <= firstMoney + 2 && 'text-right')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr><td colSpan={COLS.length} className="px-4 py-16 text-center text-sm text-slate-400">
                      {effective.length ? 'Nothing matches these filters.' : 'No transport movements on the MC Report for this half month yet.'}
                    </td></tr>
                  )}
                  {visible.map(l => {
                    const f = figures.get(l.id)
                    const newDay = l.serviceDate !== lastDay
                    lastDay = l.serviceDate
                    const e = edits[l.id] ?? {}
                    const changed = (k: string) => k in e || isAdded(l.id)
                    const ro = !editable || l.isRemoved
                    const isOpen = expanded === l.id
                    return (
                      <Fragment key={l.id}>
                        {newDay && (
                          <tr className="bg-gradient-to-r from-indigo-50/80 to-transparent">
                            <td colSpan={COLS.length} className="px-3 py-1.5 text-[11px] font-bold text-indigo-700">
                              <span className="inline-flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" />{fmtDay(l.serviceDate)}</span>
                              {editable && (
                                <button onClick={() => addRow(l.serviceDate)} className="ml-3 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-indigo-500 hover:bg-indigo-100">
                                  <Plus className="h-3 w-3" /> add row on this day
                                </button>
                              )}
                            </td>
                          </tr>
                        )}
                        <tr className={cn('group border-b border-slate-100 align-top hover:bg-slate-50/70',
                          l.isRemoved && 'opacity-40', l.bookingCancelled && 'bg-rose-50/40 line-through decoration-rose-300',
                          l.approvalStatus === 'REJECTED' && !l.bookingCancelled && 'bg-rose-50/30',
                          isAdded(l.id) && 'bg-emerald-50/40')}>
                          <td className="w-[112px] px-1 py-1">
                            <input type="date" disabled={ro} value={l.serviceDate} min={sheet.periodStart} max={sheet.periodEnd}
                              onChange={ev => ev.target.value && setField(l, 'serviceDate', ev.target.value)} className={cn(CELL, changed('serviceDate') && 'bg-amber-50')} />
                            <div className="flex flex-wrap gap-1 px-1.5">
                              {l.source === 'MANUAL' && <span className="rounded bg-emerald-100 px-1 text-[9px] font-bold text-emerald-700">MANUAL</span>}
                              {l.importRow != null && <span className="rounded bg-sky-100 px-1 text-[9px] font-bold text-sky-700" title={`From ${l.importedFrom ?? 'the Excel'}, row ${l.importRow}`}>XLS r{l.importRow}</span>}
                              {l.mcMissing && <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700" title="This movement is no longer on the MC Report for this half and country">NOT ON MC</span>}
                            </div>
                          </td>
                          <td className="w-[120px] px-1 py-1">
                            <input disabled={ro} value={l.tourNo ?? ''} onChange={ev => setField(l, 'tourNo', ev.target.value)} className={cn(CELL, 'font-mono font-bold', changed('tourNo') && 'bg-amber-50')} />
                            {!parties && l.vendorName && <div className="truncate px-1.5 text-[10px] text-slate-400" title={`Vendor / driver: ${l.vendorName}`}>{l.vendorName}</div>}
                          </td>
                          {parties && (
                            <td className="w-[170px] px-1 py-1">
                              <input disabled={ro} value={l.driverName ?? ''} onChange={ev => setDriver(l, ev.target.value)}
                                placeholder={l.vendorName ?? 'Driver'}
                                title={l.driverEdited ? 'Typed on this sheet — a refresh from MC leaves it' : 'From the MC Report'}
                                className={cn(CELL, 'font-semibold', ('driverName' in e) && 'bg-amber-50')} />
                              {l.vendorName && l.vendorName !== l.driverName && (
                                <div className="truncate px-1.5 text-[10px] text-slate-400" title={`Vendor: ${l.vendorName}`}>{l.vendorName}</div>
                              )}
                              {l.supplierId != null ? (
                                <button disabled={ro} onClick={() => setSupplierPicker(l.id)}
                                  className={cn('mt-0.5 flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left hover:bg-indigo-50 disabled:hover:bg-transparent',
                                    'supplier' in e && 'bg-amber-50')}
                                  title={`${l.supplierName} — Accounts ${l.supplierSource === 'driver' ? 'driver payee' : 'supplier'}${l.supplierEdited ? ' · set on this sheet' : ' · from the MC Report'}`}>
                                  <Building2 className={cn('h-3 w-3 shrink-0', l.supplierSource === 'driver' ? 'text-sky-600' : 'text-indigo-600')} />
                                  <span className="truncate text-[11px] font-semibold text-indigo-800">{l.supplierName}</span>
                                  {l.supplierCountry && <span className="shrink-0 rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{l.supplierCountry}</span>}
                                </button>
                              ) : editable && !l.isRemoved ? (
                                <button onClick={() => setSupplierPicker(l.id)}
                                  className={cn('mt-0.5 inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-50',
                                    'supplier' in e && 'bg-amber-50')}>
                                  <Building2 className="h-3 w-3" /> Supplier
                                </button>
                              ) : <div className="px-1.5 text-[10px] text-slate-300">no supplier</div>}
                            </td>
                          )}
                          <td className="w-[150px] px-1 py-1"><input disabled={ro} value={l.guestName ?? ''} onChange={ev => setField(l, 'guestName', ev.target.value)} className={cn(CELL, changed('guestName') && 'bg-amber-50')} /></td>
                          <td className="w-[72px] px-1 py-1"><input disabled={ro} value={l.pax ?? ''} onChange={ev => setField(l, 'pax', ev.target.value)} className={cn(CELL, 'text-center', changed('pax') && 'bg-amber-50')} /></td>
                          <td className="w-[170px] px-1 py-1"><textarea rows={isOpen ? 4 : 2} disabled={ro} value={l.pickUp ?? ''} onChange={ev => setField(l, 'pickUp', ev.target.value)} className={cn(CELL, 'resize-none', changed('pickUp') && 'bg-amber-50')} /></td>
                          <td className="w-[170px] px-1 py-1"><textarea rows={isOpen ? 4 : 2} disabled={ro} value={l.dropOff ?? ''} onChange={ev => setField(l, 'dropOff', ev.target.value)} className={cn(CELL, 'resize-none', changed('dropOff') && 'bg-amber-50')} /></td>
                          <td className="w-[70px] px-1 py-1"><input disabled={ro} value={l.time ?? ''} onChange={ev => setField(l, 'time', ev.target.value)} placeholder="hh:mm" className={cn(CELL, 'text-center tabular-nums', changed('time') && 'bg-amber-50')} /></td>
                          <td className="w-[230px] px-1 py-1"><textarea rows={isOpen ? 5 : 2} disabled={ro} value={l.details ?? ''} onChange={ev => setField(l, 'details', ev.target.value)} className={cn(CELL, 'resize-none', changed('details') && 'bg-amber-50')} /></td>
                          <td className="w-[230px] px-2 py-1.5">
                            {l.mcDescription
                              ? <button onClick={() => setExpanded(isOpen ? null : l.id)} className={cn('text-left text-[11px] leading-snug text-slate-500 hover:text-slate-700', !isOpen && 'line-clamp-3')} title={isOpen ? 'Collapse' : 'Show all'}>{l.mcDescription}</button>
                              : <span className="text-[11px] text-slate-300">{l.source === 'MANUAL' ? 'added by hand' : '—'}</span>}
                          </td>
                          <td className="w-[230px] px-2 py-1.5">
                            {l.pnlDescription || l.pnlValue != null ? (
                              <button disabled={ro} onClick={() => openPicker(l)} className="w-full rounded-md px-1.5 py-1 text-left hover:bg-indigo-50 disabled:hover:bg-transparent" title={editable ? 'Change the P&L line' : undefined}>
                                <div className={cn('text-[11px] leading-snug text-slate-700', !isOpen && 'line-clamp-2')}>{l.pnlDescription ?? '—'}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                  {l.pnlCategory && <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{l.pnlCategory}</span>}
                                  {(() => { const s = pnlSource(l); return s ? (
                                    <span className={cn('inline-flex items-center gap-0.5 rounded px-1 text-[9px] font-bold', s.cls)} title={s.title}>
                                      {l.pnlMatch === 'EXCEL' ? <FileSpreadsheet className="h-2.5 w-2.5" /> : l.pnlMatch === 'AUTO' ? <Sparkles className="h-2.5 w-2.5" /> : <Link2 className="h-2.5 w-2.5" />}
                                      {s.label}{l.pnlMatch === 'AUTO' && l.pnlScore != null ? ` ${Math.round(l.pnlScore * 100)}%` : ''}
                                    </span>
                                  ) : null })()}
                                  {f && f.sharedBy > 1 && <span className="rounded bg-violet-50 px-1 text-[9px] font-bold text-violet-600" title="Several movements share this P&L line; its value is split between them by rate">shared ×{f.sharedBy}</span>}
                                  {changed('pnlLineItemId') || 'pnlLineItemId' in e ? <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700">unsaved</span> : null}
                                </div>
                              </button>
                            ) : editable && !l.isRemoved ? (
                              <button onClick={() => openPicker(l)}
                                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-100">
                                <Plus className="h-3 w-3" /> Add P&amp;L line
                              </button>
                            ) : <span className="text-[11px] text-slate-300">none</span>}
                          </td>
                          <td className="w-[120px] px-1 py-1 text-right">
                            <input disabled={ro} value={l.rateText ?? ''} onChange={ev => setField(l, 'rateText', ev.target.value)} placeholder="e.g. 100+58"
                              className={cn(CELL, 'text-right font-semibold tabular-nums', changed('rateText') && 'bg-amber-50', l.rate == null && !ro && 'bg-amber-50/40 placeholder:text-amber-400')} />
                            {l.rate != null && /[+\s]/.test(String(l.rateText ?? '').trim()) && (
                              <div className="px-1.5 text-[10px] font-semibold text-slate-500 tabular-nums">= {fmtMoney(l.rate, cur)}</div>
                            )}
                            {l.rate == null && l.mcDriverRate != null && editable && !l.isRemoved && (
                              <button onClick={() => setField(l, 'rateText', String(l.mcDriverRate))}
                                className="mt-0.5 rounded bg-sky-50 px-1.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-100"
                                title="The driver rate entered on the MC Report">use MC {fmtMoney(l.mcDriverRate, l.mcRateCurrency ?? undefined)}</button>
                            )}
                            {l.approvalStatus === 'APPROVED' && l.approvedRate != null && l.rate != null && Math.abs(l.approvedRate - l.rate) > 0.005 && (
                              <div className="px-1.5 text-[10px] text-amber-600">approved at {fmtMoney(l.approvedRate)}</div>
                            )}
                          </td>
                          <td className="w-[110px] px-2 py-1.5 text-right tabular-nums">
                            {l.pnlValue != null ? (
                              <>
                                <div className="font-semibold text-slate-700">{fmtMoney(f?.pnlShare ?? f?.pnlConverted ?? null, cur)}</div>
                                {(f && f.sharedBy > 1) || (l.pnlCurrency && l.pnlCurrency !== cur) ? (
                                  <div className="text-[10px] text-slate-400">of {fmtMoney(l.pnlValue, l.pnlCurrency ?? undefined)}</div>
                                ) : null}
                              </>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="w-[100px] px-2 py-1.5 text-right"><Diff f={f} currency={cur} /></td>
                          <td className="w-[110px] px-2 py-1.5">
                            <ApprovalChip line={l} />
                            {l.approvalNote && l.approvalStatus !== 'APPROVED' && <div className="mt-1 line-clamp-3 text-[10px] text-rose-600" title={l.approvalNote}>{l.approvalNote}</div>}
                          </td>
                          <td className="w-[44px] px-1 py-1.5 text-center">
                            {editable && (l.isRemoved
                              ? <button onClick={() => restoreRow(l)} className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="Put back"><RotateCcw className="h-3.5 w-3.5" /></button>
                              : <button onClick={() => removeRow(l)} className="rounded-md p-1.5 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100" title={l.source === 'MANUAL' ? 'Delete row' : 'Remove from sheet (kept, can be put back)'}><Trash2 className="h-3.5 w-3.5" /></button>)}
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
                {visible.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10 bg-slate-900 text-white">
                    <tr className="text-xs font-bold">
                      <td colSpan={firstMoney} className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-white/70">Sheet total · {totals.lines} lines</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{fmtMoney(totals.totalRate, cur)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{fmtMoney(totals.totalPnl, cur)}</td>
                      <td className={cn('px-2 py-2.5 text-right tabular-nums', totals.difference > 0.005 ? 'text-rose-300' : 'text-emerald-300')}>{totals.difference > 0 ? '+' : ''}{fmtMoney(totals.difference, cur)}</td>
                      <td colSpan={2} className="px-2 py-2.5 text-[10px] text-white/70">{totals.approved}✓ {totals.rejected}✗ {totals.pending}…</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {editable && (
              <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
                <button onClick={() => addRow()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">
                  <Plus className="h-3.5 w-3.5" /> Add row
                </button>
                <span className="text-[10px] text-slate-400">Edited cells are tinted until saved · removed MC rows stay out after a refresh</span>
              </div>
            )}
          </div>
        )}
      </div>

      {picker && (() => {
        const line = effective.find(l => l.id === picker)
        if (!line) return null
        const ref = refOf(line)
        const siblings = effective.filter(o => o.id !== line.id && refOf(o) === ref && !o.isRemoved && !o.bookingCancelled && o.pnlValue == null)
        return (
          <PnlPicker sheetId={id} line={line} bookingRef={ref} sheetCurrency={cur} siblings={siblings}
            onClose={() => setPicker(null)} onPick={(choice, also) => setPnl([line.id, ...also], choice)} />
        )
      })()}

      {supplierPicker && (() => {
        const line = effective.find(l => l.id === supplierPicker)
        if (!line) return null
        const who = (line.driverName || line.vendorName || '').trim().toLowerCase()
        const siblings = who ? effective.filter(o => o.id !== line.id && !o.isRemoved && !o.bookingCancelled && o.supplierId == null
          && (o.driverName || o.vendorName || '').trim().toLowerCase() === who) : []
        return (
          <SupplierPicker
            title="Supplier for this line"
            context={<><b className="font-mono text-slate-700">{line.tourNo || '—'}</b> · {fmtDay(line.serviceDate)}{line.time ? ` ${line.time}` : ''} · {line.pickUp ?? '—'} → {line.dropOff ?? '—'}</>}
            country={sheet.country}
            hint={line.driverName || line.vendorName}
            current={supplierOf(line)}
            siblings={siblings.map(o => ({ id: o.id, label: `${fmtDay(o.serviceDate)} · ${o.tourNo ?? '—'}`, sub: `${o.pickUp ?? '—'} → ${o.dropOff ?? '—'}` }))}
            siblingsLabel={`Also set on ${line.driverName || line.vendorName}'s other lines with no supplier`}
            onPick={(sup, also) => setSupplier([line.id, ...also], sup)}
            onClose={() => setSupplierPicker(null)}
          />
        )
      })()}

      <ImportDialog open={importing} onClose={() => setImporting(false)} allowed={[sheet.country]}
        fixed={{ country: sheet.country, year: sheet.periodYear, month: sheet.periodMonth, half: sheet.half }}
        onDone={() => load()} />

      {/* Save bar */}
      {dirty > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-2xl ring-1 ring-white/10">
            <span className="text-xs text-white/80">{dirty} unsaved change{dirty === 1 ? '' : 's'}</span>
            <button onClick={discard} disabled={busy !== null} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10">Discard</button>
            <button onClick={save} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60">
              {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save sheet
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function FxInput({ sheetId, from, to, value, disabled, onSave }: { sheetId: string; from: string; to: string; value: number | undefined; disabled: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(value != null ? String(value) : '')
  const [live, setLive] = useState<{ rate: number; fetchedAt: string } | null>(null)
  useEffect(() => { setV(value != null ? String(value) : '') }, [value])
  // Today's rate as a suggestion — the sheet only ever uses the rate the desk saves.
  useEffect(() => {
    let on = true
    api<{ suggestion: { rate: number; fetchedAt: string } | null }>(`/api/trans-recon/${sheetId}/fx?from=${from}`)
      .then(d => on && setLive(d.suggestion)).catch(() => {})
    return () => { on = false }
  }, [sheetId, from, to])
  const commit = () => { const n = Number(v); if (Number.isFinite(n) && n > 0 && n !== value) onSave(n) }
  return (
    <span className="inline-flex items-center gap-1.5">
      <label className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1 ring-1', value ? 'ring-slate-200' : 'bg-amber-50 ring-amber-200')}>
        <span className="font-semibold text-slate-500">1 {from} =</span>
        <input disabled={disabled} value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()}
          placeholder="rate" className="w-20 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:border-indigo-300" />
        <span className="font-semibold text-slate-500">{to}</span>
      </label>
      {live && !disabled && Math.abs((value ?? 0) - live.rate) > 1e-6 && (
        <button onClick={() => onSave(live.rate)} title={`Live rate, fetched ${new Date(live.fetchedAt).toLocaleString('en-GB')}`}
          className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100">
          use today&apos;s {live.rate}
        </button>
      )}
    </span>
  )
}

// ── Report tab ──────────────────────────────────────────────────────────────

function Report({ lines, figures, currency }: { lines: ReconLine[]; figures: Map<string, LineFigures>; currency: string }) {
  const bookings = useMemo(() => breakdown(lines, figures, byBooking).sort((a, b) => b.difference - a.difference), [lines, figures])
  const vendors = useMemo(() => breakdown(lines, figures, byVendor).sort((a, b) => b.rate - a.rate), [lines, figures])
  const suppliers = useMemo(() => breakdown(lines, figures, bySupplier).sort((a, b) => b.rate - a.rate), [lines, figures])
  const hasSuppliers = lines.some(l => l.supplierId != null)
  const days = useMemo(() => breakdown(lines, figures, byDay).sort((a, b) => a.key.localeCompare(b.key)), [lines, figures])
  const peak = Math.max(1, ...days.map(d => Math.max(d.rate, d.pnl)))

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-800">Day by day — rate against P&amp;L</div>
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-indigo-500" /> Rate</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-emerald-400" /> P&amp;L</span>
          </div>
        </div>
        <div className="flex h-40 items-end gap-1.5">
          {days.map(d => (
            <div key={d.key} className="flex flex-1 flex-col items-center gap-1" title={`${fmtDay(d.key)}: rate ${fmtMoney(d.rate, currency)} · P&L ${fmtMoney(d.pnl, currency)} · ${d.lines} lines`}>
              <div className="flex h-32 w-full items-end justify-center gap-0.5">
                <div className="w-1/2 max-w-[14px] rounded-t bg-indigo-500 transition-all" style={{ height: `${(d.rate / peak) * 100}%` }} />
                <div className="w-1/2 max-w-[14px] rounded-t bg-emerald-400 transition-all" style={{ height: `${(d.pnl / peak) * 100}%` }} />
              </div>
              <div className="text-[9px] font-semibold tabular-nums text-slate-400">{Number(d.key.slice(8))}</div>
            </div>
          ))}
          {!days.length && <div className="w-full text-center text-xs text-slate-400">No lines.</div>}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownTable title="By booking — biggest overspend first" first="Tour no" rows={bookings} currency={currency} />
        <BreakdownTable title="By vendor / driver" first="Vendor" rows={vendors} currency={currency} />
        {hasSuppliers && <BreakdownTable title="By Accounts supplier — what each one is owed" first="Supplier" rows={suppliers} currency={currency} />}
      </div>
    </div>
  )
}

function BreakdownTable({ title, first, rows, currency }: { title: string; first: string; rows: Breakdown[]; currency: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-800">{title}</div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <tr>{[first, 'Lines', 'Rate', 'P&L', 'Difference', 'Accounts'].map((h, i) => <th key={h} className={cn('px-3 py-2', i ? 'text-right' : 'text-left')}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(b => (
              <tr key={b.key} className="border-t border-slate-100">
                <td className="px-3 py-2"><div className="font-semibold text-slate-700">{b.label}</div>{b.sub && <div className="text-[10px] text-slate-400">{b.sub}</div>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.lines}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.rate, currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.pnl, currency)}</td>
                <td className={cn('px-3 py-2 text-right font-bold tabular-nums', b.difference > 0.005 ? 'text-rose-600' : b.difference < -0.005 ? 'text-emerald-600' : 'text-slate-400')}>
                  {b.difference > 0 ? '+' : ''}{fmtMoney(b.difference, currency)}
                  {b.unmatched > 0 && <div className="text-[10px] font-normal text-slate-400">+{fmtMoney(b.unmatched, currency)} unpaired</div>}
                </td>
                <td className="px-3 py-2 text-right text-[10px] text-slate-500">{b.approved}✓ {b.rejected}✗ {b.pending}…</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No lines.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
