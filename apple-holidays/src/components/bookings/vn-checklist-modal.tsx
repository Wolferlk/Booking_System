'use client'

/**
 * Vietnam booking checklist — the desk's costing sheet, as a popup.
 *
 * One row per thing a vendor is paid for; four figures at the foot (Total
 * estimate, Total VND, PNL incurred, Profit margin) that follow the Accounts
 * "Checklist VN" definitions exactly — see src/lib/vn-checklist/shared.ts.
 *
 * Edits are local until Save (or Ctrl/⌘+S); the whole sheet is written in one
 * transaction so a half-saved sheet cannot exist.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  X, Plus, Save, Loader2, Trash2, Copy, Download, Sparkles, Lock,
  CheckCircle2, CircleDashed, CircleDot, RotateCcw, AlertTriangle, ListChecks,
  Wallet, TrendingUp, TrendingDown, Coins, Receipt, ArrowRightLeft, Pencil, PackageSearch,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { codeTone, type IncludeProduct } from '@/lib/vn-includes/shared'
import {
  CHECKLIST_CODES, CHECKLIST_STATUSES, canEditChecklist, computeTotals, computedTotalVnd,
  fmtPct, fmtUsd, fmtVnd, itemTotalVnd, marginTone, parseNum,
  type ChecklistHeader, type ChecklistItem, type ChecklistPayload, type ChecklistStatus, type PaidStatus,
} from '@/lib/vn-checklist/shared'

interface Props {
  open: boolean
  bookingRef: string
  role: string
  onClose: () => void
  onSaved?: () => void
}

let tmpSeq = 0
const tmpId = () => `tmp_${Date.now().toString(36)}_${(tmpSeq++).toString(36)}`

function blankItem(pax: number, date: string | null = null): ChecklistItem {
  return {
    id: tmpId(), position: 0, serviceDate: date, description: '', vendor: null, code: null,
    unitPrice: 0, unitCurrency: 'VND', quan1: Math.max(pax, 1), quan2: 1, totalOverrideVnd: null,
    paidStatus: 'UNPAID', paidVnd: null, paidAt: null, paidByName: null, source: 'MANUAL', productKey: null, note: null,
  }
}

const snapshot = (h: ChecklistHeader, items: ChecklistItem[]) => JSON.stringify({
  s: h.status, n: h.note ?? '', r: h.revenueUsdOverride, x: h.exchangeRateOverride,
  i: items.map(({ id, serviceDate, description, vendor, code, unitPrice, unitCurrency, quan1, quan2, totalOverrideVnd, paidStatus, paidVnd, note }) =>
    [id, serviceDate, description, vendor, code, +unitPrice, unitCurrency, +quan1, +quan2, totalOverrideVnd, paidStatus, paidVnd, note]),
})

// ─── Small pieces ───────────────────────────────────────────────────────────

/** A number input that shows grouped digits at rest and the raw figure while typing. */
function NumCell({
  value, onChange, disabled, className, placeholder, decimals = 0, allowEmpty = false, title,
}: {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  decimals?: number
  allowEmpty?: boolean
  title?: string
}) {
  const [focus, setFocus] = useState(false)
  const [text, setText] = useState('')
  const shown = focus
    ? text
    : value === null || value === undefined
      ? ''
      : value.toLocaleString('en-US', { maximumFractionDigits: decimals })
  return (
    <input
      type="text"
      inputMode="decimal"
      title={title}
      disabled={disabled}
      placeholder={placeholder}
      value={shown}
      onFocus={e => { setFocus(true); setText(value === null || value === undefined ? '' : String(value)); requestAnimationFrame(() => e.target.select()) }}
      onChange={e => {
        setText(e.target.value)
        const raw = e.target.value.trim()
        if (raw === '') onChange(allowEmpty ? null : 0)
        else if (/^-?[\d,]*\.?\d*$/.test(raw.replace(/\s/g, ''))) onChange(parseNum(raw))
      }}
      onBlur={() => setFocus(false)}
      className={cn(
        'w-full bg-transparent text-right tabular-nums rounded-md px-2 py-1.5 outline-none transition',
        'hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-300/70 disabled:hover:bg-transparent disabled:text-slate-500',
        className,
      )}
    />
  )
}

function MarginRing({ value }: { value: number | null }) {
  const tone = marginTone(value)
  const pct = value === null ? 0 : Math.max(0, Math.min(1, Math.abs(value)))
  const R = 26, C = 2 * Math.PI * R
  const stroke = tone === 'neg' ? '#e11d48' : tone === 'thin' ? '#f59e0b' : tone === 'ok' ? '#10b981' : '#cbd5e1'
  return (
    <div className="relative w-[68px] h-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="currentColor" strokeWidth="7" className="text-slate-100" />
        <circle
          cx="32" cy="32" r={R} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`} style={{ transition: 'stroke-dasharray .5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={cn('text-[13px] font-bold tabular-nums',
          tone === 'neg' ? 'text-rose-600' : tone === 'thin' ? 'text-amber-600' : tone === 'ok' ? 'text-emerald-600' : 'text-slate-400')}>
          {fmtPct(value)}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-slate-400 mt-0.5">margin</span>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone = 'slate', children }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode
  icon: typeof Wallet; tone?: 'slate' | 'rose' | 'emerald' | 'amber' | 'sky' | 'violet'
  children?: React.ReactNode
}) {
  const tones = {
    slate: 'from-slate-50 to-white text-slate-600 ring-slate-200',
    rose: 'from-rose-50 to-white text-rose-600 ring-rose-200',
    emerald: 'from-emerald-50 to-white text-emerald-600 ring-emerald-200',
    amber: 'from-amber-50 to-white text-amber-600 ring-amber-200',
    sky: 'from-sky-50 to-white text-sky-600 ring-sky-200',
    violet: 'from-violet-50 to-white text-violet-600 ring-violet-200',
  }[tone]
  return (
    <div className={cn('rounded-xl bg-gradient-to-br ring-1 px-3.5 py-2.5 min-w-0', tones)}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums truncate">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
      {children}
    </div>
  )
}

const PAID_META: Record<PaidStatus, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  UNPAID:  { label: 'Unpaid',  icon: CircleDashed, cls: 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-300' },
  PARTIAL: { label: 'Partial', icon: CircleDot,    cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  PAID:    { label: 'Paid',    icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
}
const NEXT_PAID: Record<PaidStatus, PaidStatus> = { UNPAID: 'PAID', PAID: 'PARTIAL', PARTIAL: 'UNPAID' }

// ─── Product sheet search ───────────────────────────────────────────────────

function ProductSearch({ onPick, disabled }: { onPick: (p: IncludeProduct) => void; disabled?: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<IncludeProduct[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [hi, setHi] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setResults([]); setErr(null); return }
      setBusy(true)
      try {
        const res = await fetch(`/api/vn-includes/products?q=${encodeURIComponent(q)}&limit=12`)
        const json = await res.json()
        if (!json.success) { setErr(json.error); setResults([]) } else { setErr(null); setResults(json.data); setHi(0) }
      } catch { setErr('Search failed') } finally { setBusy(false) }
    }, 220)
    return () => clearTimeout(t)
  }, [q, open])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (p: IncludeProduct) => { onPick(p); setQ(''); setResults([]); setOpen(false) }

  return (
    <div ref={boxRef} className="relative w-full sm:w-80">
      <div className={cn('flex items-center gap-2 rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 focus-within:ring-2 focus-within:ring-rose-300', disabled && 'opacity-50')}>
        {busy ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" /> : <PackageSearch className="w-4 h-4 text-slate-400" />}
        <input
          disabled={disabled}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
            if (e.key === 'Enter' && results[hi]) { e.preventDefault(); pick(results[hi]) }
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
          }}
          placeholder="Add from product sheet… (e.g. hal cru)"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>
      {open && (results.length > 0 || err || (q.trim().length >= 2 && !busy)) && (
        <div className="absolute z-30 mt-1.5 w-[28rem] max-w-[90vw] rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden">
          {err ? (
            <div className="p-3 text-xs text-amber-700 bg-amber-50 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {err}</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-xs text-slate-500">No product matches — add a manual row instead.</div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(p)}
                    className={cn('w-full text-left px-3 py-2 flex items-center gap-3', i === hi ? 'bg-rose-50' : 'hover:bg-slate-50')}
                  >
                    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 shrink-0', codeTone(p.code))}>{p.code}</span>
                    <span className="flex-1 text-sm text-slate-800 line-clamp-2">{p.name}</span>
                    <span className="text-xs tabular-nums text-slate-500 shrink-0">{p.minPriceVnd !== null ? `₫${fmtVnd(p.minPriceVnd)}` : '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ─── The popup ──────────────────────────────────────────────────────────────

export default function VnChecklistModal({ open, bookingRef, role, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [data, setData] = useState<ChecklistPayload | null>(null)
  const [header, setHeader] = useState<ChecklistHeader | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [saved, setSaved] = useState('')
  const [codeFilter, setCodeFilter] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/vn-checklist/${encodeURIComponent(bookingRef)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const p = json.data as ChecklistPayload
      setData(p); setHeader(p.header); setItems(p.items); setSaved(snapshot(p.header, p.items))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the checklist')
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { if (open) load() }, [open, load])

  const pax = data ? data.live.pax.adults + data.live.pax.children : 1
  const finalLocked = header?.status === 'FINAL' && !['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const editable = !!data?.installed && canEditChecklist(role) && !finalLocked
  const dirty = !!header && snapshot(header, items) !== saved

  const totals = useMemo(
    () => (header && data ? computeTotals(header, items, data.live) : null),
    [header, items, data],
  )
  const vendors = useMemo(
    () => Array.from(new Set(items.map(i => i.vendor?.trim()).filter(Boolean) as string[])).sort(),
    [items],
  )
  const tripDays = useMemo(() => {
    if (!data?.booking.arrivalDate || !data.booking.departureDate) return [] as string[]
    const out: string[] = []
    const d = new Date(`${data.booking.arrivalDate}T00:00:00Z`)
    const end = new Date(`${data.booking.departureDate}T00:00:00Z`)
    while (d <= end && out.length < 40) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
    return out
  }, [data])

  const patch = (id: string, p: Partial<ChecklistItem>) =>
    setItems(list => list.map(i => (i.id === id ? { ...i, ...p } : i)))

  const addRow = (seed?: Partial<ChecklistItem>) => {
    const last = items[items.length - 1]
    const row = { ...blankItem(pax, last?.serviceDate ?? data?.booking.arrivalDate ?? null), ...seed, id: tmpId() }
    setItems(list => [...list, row])
    requestAnimationFrame(() => {
      const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${row.id}"] [data-focus="desc"]`)
      el?.focus()
      tableRef.current?.scrollTo({ top: tableRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  const save = useCallback(async () => {
    if (!header || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vn-checklist/${encodeURIComponent(bookingRef)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ header, items }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const p = json.data as ChecklistPayload
      setData(p); setHeader(p.header); setItems(p.items); setSaved(snapshot(p.header, p.items))
      toast.success('Checklist saved')
      onSaved?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [header, items, bookingRef, saving, onSaved])

  const close = useCallback(() => {
    if (dirty && !window.confirm('You have unsaved changes on this checklist. Close without saving?')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (editable && dirty) save() }
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, editable, dirty, save, close])

  const importIncludes = async () => {
    setImporting(true)
    try {
      const res = await fetch(`/api/vn-checklist/${encodeURIComponent(bookingRef)}/includes`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const drafts = json.data as Partial<ChecklistItem>[]
      const have = new Set(items.map(i => `${i.productKey ?? i.description.toLowerCase()}|${i.serviceDate}`))
      const fresh = drafts.filter(d => !have.has(`${d.productKey ?? String(d.description).toLowerCase()}|${d.serviceDate}`))
      if (drafts.length === 0) toast.info('No includes picked on this booking’s agenda yet')
      else if (fresh.length === 0) toast.info('Every agenda include is already on the sheet')
      else {
        setItems(list => [...list, ...fresh.map(d => ({ ...blankItem(pax), ...d, id: tmpId() }))])
        toast.success(`${fresh.length} row${fresh.length === 1 ? '' : 's'} added from the agenda — review and save`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the agenda')
    } finally {
      setImporting(false)
    }
  }

  const exportCsv = () => {
    if (!totals || !data) return
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['Date', 'Details for payment', 'Vendor', 'Code', 'Unit price', 'Currency', 'Quan1', 'Quan2', 'Total estimate (VND)', 'Paid', 'Paid (VND)', 'Note'],
      ...items.map(i => [
        i.serviceDate ?? '', i.description, i.vendor ?? '', i.code ?? '', i.unitPrice, i.unitCurrency, i.quan1, i.quan2,
        itemTotalVnd(i, totals.rate), i.paidStatus, i.paidStatus === 'UNPAID' ? '' : (i.paidVnd ?? itemTotalVnd(i, totals.rate)), i.note ?? '',
      ]),
      [],
      ['Revenue USD', totals.revenueUsd ?? ''],
      ['Exchange rate', totals.rate],
      ['Total VND', totals.totalVnd ?? ''],
      ['Total estimate', totals.totalEstimateVnd ?? ''],
      ['PNL incurred', totals.pnlIncurredVnd ?? ''],
      ['Profit margin', totals.profitMargin !== null ? (totals.profitMargin * 100).toFixed(2) + '%' : ''],
    ]
    const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Checklist-${bookingRef}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!open) return null

  const shownItems = codeFilter ? items.filter(i => (i.code || 'Other') === codeFilter) : items
  const paidPct = totals && totals.totalEstimateVnd ? Math.min(1, totals.paidVnd / totals.totalEstimateVnd) : 0
  const tone = marginTone(totals?.profitMargin ?? null)

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={close} />
      <div className="relative w-full max-w-[1480px] h-full sm:h-[94vh] bg-slate-50 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="relative overflow-hidden bg-gradient-to-r from-rose-600 via-red-600 to-amber-500 text-white">
          <div className="absolute -right-10 -top-16 w-64 h-64 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute right-40 -bottom-24 w-56 h-56 rounded-full bg-amber-300/20 blur-2xl" />
          <div className="relative px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="w-10 h-10 rounded-xl bg-white/15 ring-1 ring-white/30 flex items-center justify-center">
              <ListChecks className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">Check List</h2>
                <span className="text-[10px] font-bold uppercase tracking-widest bg-white/20 rounded px-1.5 py-0.5">Vietnam</span>
              </div>
              <p className="text-xs text-white/85 truncate">
                <span className="font-mono font-semibold">{bookingRef}</span>
                {data?.booking.cntlNumber && <> · CNTL {data.booking.cntlNumber}</>}
                {data?.booking.agent && <> · {data.booking.agent}</>}
                {data && <> · {data.live.pax.adults} ad{data.live.pax.children ? ` + ${data.live.pax.children} ch` : ''}</>}
                {data?.booking.arrivalDate && <> · {data.booking.arrivalDate} → {data.booking.departureDate}</>}
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* Status */}
              {header && (
                <div className="flex rounded-xl bg-white/15 ring-1 ring-white/25 p-0.5">
                  {CHECKLIST_STATUSES.map(s => (
                    <button
                      key={s.value}
                      disabled={!canEditChecklist(role) || !data?.installed || (finalLocked && s.value !== 'FINAL')}
                      onClick={() => setHeader(h => (h ? { ...h, status: s.value as ChecklistStatus } : h))}
                      className={cn(
                        'px-3 py-1 text-xs font-semibold rounded-lg transition',
                        header.status === s.value ? 'bg-white text-rose-700 shadow' : 'text-white/85 hover:bg-white/10 disabled:hover:bg-transparent',
                      )}
                    >
                      {s.value === 'FINAL' && <Lock className="w-3 h-3 inline -mt-0.5 mr-1" />}{s.label}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={close} className="w-9 h-9 rounded-xl hover:bg-white/15 flex items-center justify-center" title="Close (Esc)">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : error || !data || !header || !totals ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm">{error ?? 'Could not load the checklist'}</p>
            <button onClick={load} className="btn btn-secondary btn-sm"><RotateCcw className="w-3.5 h-3.5" /> Retry</button>
          </div>
        ) : (
          <>
            {!data.installed && (
              <div className="mx-5 mt-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-sm text-amber-800 flex gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>The checklist tables are not on this database yet. Run <code className="font-mono text-xs bg-amber-100 px-1 rounded">bash prisma/sql/apply-vn-booking-checklist.sh</code> from <code className="font-mono text-xs">apple-holidays/</code>, then reopen.</span>
              </div>
            )}
            {finalLocked && (
              <div className="mx-5 mt-4 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-2.5 text-sm text-emerald-800 flex gap-2 items-center">
                <Lock className="w-4 h-4" /> Final{header.checkedByName ? ` — signed off by ${header.checkedByName}` : ''}. Only Accounts can reopen it.
              </div>
            )}

            {/* ── KPI strip ──────────────────────────────────────────── */}
            <div className="px-5 pt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto] gap-3">
              <Kpi
                label="Revenue USD" icon={Coins} tone="sky"
                sub={header.revenueUsdOverride !== null
                  ? <span className="inline-flex items-center gap-1 text-amber-600"><Pencil className="w-3 h-3" /> typed · live {fmtUsd(data.live.revenueUsd)}</span>
                  : data.live.revenueSource === 'QUOTED' ? 'from the booking’s quoted total' : data.live.revenueSource === 'PNL' ? 'from the booking’s P&L' : 'no revenue on the booking — type it'}
                value={
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 text-base">$</span>
                    <NumCell
                      value={header.revenueUsdOverride ?? data.live.revenueUsd}
                      onChange={v => setHeader(h => (h ? { ...h, revenueUsdOverride: v } : h))}
                      disabled={!editable} decimals={2} allowEmpty
                      className="!text-left !px-1 !py-0 text-lg font-bold"
                    />
                    {header.revenueUsdOverride !== null && editable && (
                      <button title="Back to the live value" onClick={() => setHeader(h => (h ? { ...h, revenueUsdOverride: null } : h))} className="text-slate-400 hover:text-slate-700">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                }
              />
              <Kpi
                label="Exchange rate" icon={ArrowRightLeft} tone="violet"
                sub={header.exchangeRateOverride !== null ? 'typed for this booking' : 'house rate (Accounts)'}
                value={
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 text-xs whitespace-nowrap">₫/$</span>
                    <NumCell
                      value={header.exchangeRateOverride ?? data.live.exchangeRate}
                      onChange={v => setHeader(h => (h ? { ...h, exchangeRateOverride: v } : h))}
                      disabled={!editable} decimals={2} allowEmpty
                      className="!text-left !px-1 !py-0 text-lg font-bold"
                    />
                    {header.exchangeRateOverride !== null && editable && (
                      <button title="Back to the house rate" onClick={() => setHeader(h => (h ? { ...h, exchangeRateOverride: null } : h))} className="text-slate-400 hover:text-slate-700">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                }
              />
              <Kpi label="Total VND" icon={Receipt} tone="slate" value={`₫ ${fmtVnd(totals.totalVnd)}`} sub="revenue × rate — what it sold for" />
              <Kpi label="Total estimate" icon={Wallet} tone="amber" value={`₫ ${fmtVnd(totals.totalEstimateVnd)}`}
                sub={totals.costUsd !== null ? `≈ ${fmtUsd(totals.costUsd)} · ${totals.itemCount} rows` : 'add rows to cost the trip'} />
              <Kpi
                label="PNL incurred" icon={tone === 'neg' ? TrendingDown : TrendingUp} tone={tone === 'neg' ? 'rose' : 'emerald'}
                value={<span className={cn(tone === 'neg' && 'text-rose-600')}>₫ {fmtVnd(totals.pnlIncurredVnd)}</span>}
                sub={totals.profitUsd !== null ? `profit ≈ ${fmtUsd(totals.profitUsd)}` : 'Total VND − Total estimate'}
              />
              <div className="rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 flex items-center gap-3 col-span-2 md:col-span-1">
                <MarginRing value={totals.profitMargin} />
                <div className="text-[11px] text-slate-500 leading-snug">
                  <div className="font-semibold text-slate-700 text-xs">Profit margin</div>
                  PNL ÷ Total VND
                </div>
              </div>
            </div>

            {/* ── Paid progress + P&L tally ────────────────────────── */}
            <div className="px-5 pt-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[260px] rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Payments</span>
                  <span className="text-slate-500 tabular-nums">
                    <b className="text-emerald-600">₫ {fmtVnd(totals.paidVnd)}</b> paid · ₫ {fmtVnd(totals.outstandingVnd)} to pay · {totals.paidCount}/{totals.itemCount} rows
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500" style={{ width: `${paidPct * 100}%` }} />
                </div>
              </div>
              <div className={cn('rounded-xl ring-1 px-4 py-2.5 text-xs',
                totals.pnlDiffUsd === null ? 'bg-white ring-slate-200 text-slate-500'
                  : Math.abs(totals.pnlDiffUsd) < 1 ? 'bg-emerald-50 ring-emerald-200 text-emerald-800'
                  : totals.pnlDiffUsd > 0 ? 'bg-rose-50 ring-rose-200 text-rose-800' : 'bg-amber-50 ring-amber-200 text-amber-800')}>
                <div className="font-semibold">Tally vs OPS P&amp;L</div>
                {totals.pnlDiffUsd === null
                  ? <span>{data.live.pnlCostUsd === null ? 'No P&L cost on this booking' : 'Add rows to compare'}</span>
                  : <span className="tabular-nums">Sheet {fmtUsd(totals.costUsd)} vs P&amp;L {fmtUsd(data.live.pnlCostUsd)} ·{' '}
                      <b>{Math.abs(totals.pnlDiffUsd) < 1 ? 'matched' : `${totals.pnlDiffUsd > 0 ? '+' : ''}${fmtUsd(totals.pnlDiffUsd)}`}</b></span>}
              </div>
            </div>

            {/* ── Toolbar ────────────────────────────────────────────── */}
            <div className="px-5 pt-4 pb-2 flex flex-wrap items-center gap-2">
              <button
                disabled={!editable}
                onClick={() => addRow()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 text-white px-3.5 py-2 text-sm font-semibold shadow-sm hover:bg-rose-700 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" /> Add item
              </button>
              <ProductSearch
                disabled={!editable}
                onPick={p => addRow({
                  description: p.name, code: p.code, unitPrice: p.minPriceVnd ?? 0, unitCurrency: 'VND',
                  source: 'CATALOG', productKey: p.productKey,
                })}
              />
              <button
                disabled={!editable || importing}
                onClick={importIncludes}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Add the products already picked on this booking's agenda (Includes)"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-violet-500" />} From agenda
              </button>
              <div className="flex items-center gap-1 flex-wrap ml-1">
                {totals.byCode.map(c => (
                  <button
                    key={c.code}
                    onClick={() => setCodeFilter(f => (f === c.code ? null : c.code))}
                    className={cn('text-[11px] font-semibold px-2 py-1 rounded-lg ring-1 transition', codeTone(c.code),
                      codeFilter && codeFilter !== c.code && 'opacity-40')}
                    title={`₫ ${fmtVnd(c.totalVnd)}`}
                  >
                    {c.code} <span className="opacity-70">{c.count}</span>
                  </button>
                ))}
                {codeFilter && <button onClick={() => setCodeFilter(null)} className="text-[11px] text-slate-500 hover:text-slate-800 px-1">clear</button>}
              </div>
              <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <Download className="w-4 h-4" /> CSV
              </button>
            </div>

            {/* ── The sheet ──────────────────────────────────────────── */}
            <div ref={tableRef} className="flex-1 overflow-auto px-5 pb-4">
              <datalist id="vn-cl-vendors">{vendors.map(v => <option key={v} value={v} />)}</datalist>
              <datalist id="vn-cl-codes">{CHECKLIST_CODES.map(c => <option key={c} value={c} />)}</datalist>
              <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden min-w-[1180px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-800 text-white text-[10.5px] uppercase tracking-wider">
                    <tr>
                      <th className="w-9 py-2.5 pl-3 text-left">#</th>
                      <th className="w-[120px] px-2 text-left">Date</th>
                      <th className="w-[108px] px-2 text-left">Code</th>
                      <th className="px-2 text-left">Details for payment</th>
                      <th className="w-[170px] px-2 text-left">Vendor</th>
                      <th className="w-[150px] px-2 text-right">Unit price</th>
                      <th className="w-[68px] px-2 text-right">Quan1</th>
                      <th className="w-[68px] px-2 text-right">Quan2</th>
                      <th className="w-[150px] px-2 text-right">Total estimate ₫</th>
                      <th className="w-[130px] px-2 text-center">Paid</th>
                      <th className="w-[64px] pr-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shownItems.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-14 text-center">
                          <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mb-3">
                            <ListChecks className="w-6 h-6 text-rose-500" />
                          </div>
                          <p className="text-sm font-semibold text-slate-700">{codeFilter ? 'Nothing under this code' : 'No items yet'}</p>
                          <p className="text-xs text-slate-500 mt-1">Add an item, search the product sheet, or pull in what the agenda already includes.</p>
                        </td>
                      </tr>
                    )}
                    {shownItems.map(it => {
                      const idx = items.indexOf(it)
                      const computed = computedTotalVnd(it, totals.rate)
                      const total = itemTotalVnd(it, totals.rate)
                      const overridden = it.totalOverrideVnd !== null
                      const pm = PAID_META[it.paidStatus]
                      return (
                        <tr key={it.id} data-row={it.id} className={cn('group transition-colors hover:bg-rose-50/30', it.paidStatus === 'PAID' && 'bg-emerald-50/30')}>
                          <td className="pl-3 py-1 text-[11px] text-slate-400 tabular-nums align-middle">
                            <div className="flex items-center gap-1">
                              {idx + 1}
                              {it.source !== 'MANUAL' && (
                                <span title={it.source === 'INCLUDE' ? 'From the agenda includes' : 'From the product sheet'}
                                  className={cn('w-1.5 h-1.5 rounded-full', it.source === 'INCLUDE' ? 'bg-violet-400' : 'bg-sky-400')} />
                              )}
                            </div>
                          </td>
                          <td className="px-1">
                            <input
                              type="date" disabled={!editable} value={it.serviceDate ?? ''}
                              min={tripDays[0]} max={tripDays[tripDays.length - 1]}
                              onChange={e => patch(it.id, { serviceDate: e.target.value || null })}
                              className="w-full bg-transparent rounded-md px-1.5 py-1.5 text-xs text-slate-700 outline-none hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-300/70"
                            />
                          </td>
                          <td className="px-1">
                            <div className="relative">
                              <input
                                list="vn-cl-codes" disabled={!editable} value={it.code ?? ''} placeholder="Code"
                                onChange={e => patch(it.id, { code: e.target.value || null })}
                                className={cn('w-full rounded-md px-2 py-1 text-[11px] font-semibold outline-none ring-1 focus:ring-2 focus:ring-rose-300/70',
                                  it.code ? codeTone(it.code) : 'bg-transparent ring-transparent hover:bg-slate-50 text-slate-500')}
                              />
                            </div>
                          </td>
                          <td className="px-1">
                            <input
                              data-focus="desc" disabled={!editable} value={it.description} placeholder="What is being paid for…"
                              onChange={e => patch(it.id, { description: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter' && idx === items.length - 1) { e.preventDefault(); addRow() } }}
                              className="w-full bg-transparent rounded-md px-2 py-1.5 text-slate-800 outline-none hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-300/70"
                            />
                            {(it.note || editable) && (
                              <input
                                disabled={!editable} value={it.note ?? ''} placeholder={editable ? '+ note' : ''}
                                onChange={e => patch(it.id, { note: e.target.value || null })}
                                className="w-full bg-transparent rounded-md px-2 pb-1 -mt-1 text-[11px] text-slate-400 outline-none placeholder:text-slate-300 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[has=true]:opacity-100"
                                data-has={!!it.note}
                              />
                            )}
                          </td>
                          <td className="px-1">
                            <input
                              list="vn-cl-vendors" disabled={!editable} value={it.vendor ?? ''} placeholder="Vendor"
                              onChange={e => patch(it.id, { vendor: e.target.value || null })}
                              className="w-full bg-transparent rounded-md px-2 py-1.5 text-slate-700 outline-none hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-300/70"
                            />
                          </td>
                          <td className="px-1">
                            <div className="flex items-center">
                              <button
                                disabled={!editable}
                                onClick={() => patch(it.id, { unitCurrency: it.unitCurrency === 'VND' ? 'USD' : 'VND' })}
                                title="Switch the unit currency"
                                className={cn('text-[10px] font-bold rounded px-1.5 py-0.5 ring-1 shrink-0',
                                  it.unitCurrency === 'USD' ? 'bg-sky-50 text-sky-700 ring-sky-200' : 'bg-slate-50 text-slate-500 ring-slate-200')}
                              >
                                {it.unitCurrency === 'USD' ? '$' : '₫'}
                              </button>
                              <NumCell value={it.unitPrice} onChange={v => patch(it.id, { unitPrice: v ?? 0 })} disabled={!editable} decimals={it.unitCurrency === 'USD' ? 2 : 0} />
                            </div>
                          </td>
                          <td className="px-1"><NumCell value={it.quan1} onChange={v => patch(it.id, { quan1: v ?? 0 })} disabled={!editable} decimals={2} /></td>
                          <td className="px-1"><NumCell value={it.quan2} onChange={v => patch(it.id, { quan2: v ?? 0 })} disabled={!editable} decimals={2} /></td>
                          <td className="px-1">
                            <div className="flex items-center gap-1">
                              {overridden && editable && (
                                <button title={`Typed total — computed is ₫ ${fmtVnd(computed)}. Click to use the computed total.`}
                                  onClick={() => patch(it.id, { totalOverrideVnd: null })} className="text-amber-500 hover:text-amber-700 shrink-0">
                                  <RotateCcw className="w-3 h-3" />
                                </button>
                              )}
                              <NumCell
                                value={total}
                                title={overridden ? `Typed total (computed ₫ ${fmtVnd(computed)})` : 'Unit × Quan1 × Quan2 — type to override'}
                                onChange={v => patch(it.id, { totalOverrideVnd: v === null || v === computed ? null : v })}
                                disabled={!editable}
                                className={cn('font-semibold', overridden ? 'text-amber-700 bg-amber-50/60' : 'text-slate-900')}
                              />
                            </div>
                          </td>
                          <td className="px-1 text-center">
                            <button
                              disabled={!editable}
                              onClick={() => patch(it.id, { paidStatus: NEXT_PAID[it.paidStatus], paidVnd: NEXT_PAID[it.paidStatus] === 'PARTIAL' ? Math.round(total / 2) : null })}
                              title={it.paidAt ? `${pm.label}${it.paidByName ? ` by ${it.paidByName}` : ''} · ${new Date(it.paidAt).toLocaleString()}` : 'Click to change'}
                              className={cn('inline-flex items-center gap-1 rounded-full ring-1 px-2.5 py-1 text-[11px] font-semibold transition', pm.cls)}
                            >
                              <pm.icon className="w-3.5 h-3.5" /> {pm.label}
                            </button>
                            {it.paidStatus === 'PARTIAL' && (
                              <NumCell value={it.paidVnd} onChange={v => patch(it.id, { paidVnd: v })} disabled={!editable} allowEmpty
                                className="!py-0.5 mt-0.5 text-[11px] text-amber-700 !text-center" placeholder="paid ₫" />
                            )}
                          </td>
                          <td className="pr-3 text-right">
                            {editable && (
                              <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition">
                                <button title="Duplicate" onClick={() => setItems(list => {
                                  const copy = { ...it, id: tmpId(), paidStatus: 'UNPAID' as const, paidVnd: null, paidAt: null, paidByName: null }
                                  const out = [...list]; out.splice(idx + 1, 0, copy); return out
                                })} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button title="Remove" onClick={() => setItems(list => list.filter(i => i.id !== it.id))}
                                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {items.length > 0 && (
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200 text-xs">
                      <tr>
                        <td colSpan={8} className="py-2.5 pl-3 font-semibold text-slate-600">
                          Total estimate{codeFilter && <span className="font-normal text-slate-400"> (all codes)</span>}
                        </td>
                        <td className="px-3 text-right font-bold text-slate-900 tabular-nums text-sm">₫ {fmtVnd(totals.totalEstimateVnd)}</td>
                        <td className="px-2 text-center text-emerald-700 font-semibold tabular-nums">₫ {fmtVnd(totals.paidVnd)}</td>
                        <td />
                      </tr>
                      <tr className="text-slate-500">
                        <td colSpan={8} className="py-1.5 pl-3">Total VND <span className="text-slate-400">(revenue {fmtUsd(totals.revenueUsd)} × {totals.rate.toLocaleString()})</span></td>
                        <td className="px-3 text-right tabular-nums font-semibold text-slate-700">₫ {fmtVnd(totals.totalVnd)}</td>
                        <td colSpan={2} />
                      </tr>
                      <tr>
                        <td colSpan={8} className="py-1.5 pl-3 font-semibold text-slate-600">PNL incurred · Profit margin</td>
                        <td className={cn('px-3 text-right tabular-nums font-bold text-sm', tone === 'neg' ? 'text-rose-600' : 'text-emerald-600')}>₫ {fmtVnd(totals.pnlIncurredVnd)}</td>
                        <td className={cn('px-2 text-center font-bold', tone === 'neg' ? 'text-rose-600' : tone === 'thin' ? 'text-amber-600' : 'text-emerald-600')}>{fmtPct(totals.profitMargin)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Vendor breakdown */}
              {totals.byVendor.length > 1 && (
                <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {totals.byVendor.slice(0, 8).map(v => {
                    const share = totals.totalEstimateVnd ? v.totalVnd / totals.totalEstimateVnd : 0
                    const paid = v.totalVnd > 0 ? Math.min(1, v.paidVnd / v.totalVnd) : 0
                    return (
                      <div key={v.vendor} className="rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700 truncate">{v.vendor}</span>
                          <span className="text-[10px] text-slate-400">{(share * 100).toFixed(0)}%</span>
                        </div>
                        <div className="text-sm font-bold tabular-nums text-slate-900">₫ {fmtVnd(v.totalVnd)}</div>
                        <div className="mt-1.5 h-1 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${paid * 100}%` }} />
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{v.count} row{v.count === 1 ? '' : 's'} · {(paid * 100).toFixed(0)}% paid</div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Note */}
              <div className="mt-4">
                <textarea
                  disabled={!editable}
                  value={header.note ?? ''}
                  onChange={e => setHeader(h => (h ? { ...h, note: e.target.value } : h))}
                  placeholder="Notes for this checklist (supplier remarks, what to verify with Accounts…)"
                  rows={2}
                  className="w-full rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-300 resize-y"
                />
              </div>
            </div>

            {/* ── Footer ─────────────────────────────────────────────── */}
            <div className="border-t border-slate-200 bg-white px-5 py-3 flex items-center gap-3">
              <div className="text-xs text-slate-500 min-w-0 truncate">
                {dirty ? <span className="inline-flex items-center gap-1.5 text-amber-600 font-medium"><span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /> Unsaved changes</span>
                  : header.updatedAt ? <>Saved{header.updatedByName ? ` by ${header.updatedByName}` : ''} · {new Date(header.updatedAt).toLocaleString()}</>
                  : data.installed ? 'New checklist' : ''}
                {header.checkedByName && header.status !== 'DRAFT' && <> · {header.status === 'FINAL' ? 'Final' : 'Checked'} by {header.checkedByName}</>}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={close} className="btn btn-secondary btn-sm">Close</button>
                {canEditChecklist(role) && (
                  <button
                    onClick={save}
                    disabled={!editable || !dirty || saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-40"
                    title="Save (Ctrl/⌘ + S)"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                    <kbd className="hidden md:inline text-[10px] font-mono bg-white/15 rounded px-1">⌘S</kbd>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

