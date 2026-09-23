'use client'

/**
 * Check List VN — every Vietnam booking arriving in a window, with its costing
 * sheet's four figures (Total estimate, Total VND, PNL incurred, margin) and
 * how much of it is paid. Click a row to open the same popup the booking page uses.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  Search, Loader2, ListChecks, AlertTriangle, TrendingUp, TrendingDown, Wallet, Receipt,
  CircleDashed, CheckCircle2, Lock, ExternalLink, CalendarRange, Coins,
} from 'lucide-react'
import Header from '@/components/layout/header'
import VnChecklistModal from '@/components/bookings/vn-checklist-modal'
import { cn } from '@/lib/utils'
import {
  CHECKLIST_NOT_INSTALLED, canViewChecklist, fmtPct, fmtUsd, fmtVnd, marginTone,
  type ChecklistBookingInfo, type ChecklistHeader, type ChecklistTotals,
} from '@/lib/vn-checklist/shared'

interface Row {
  booking: ChecklistBookingInfo
  pax: number
  header: ChecklistHeader | null
  totals: ChecklistTotals
  revenueSource: 'PNL' | 'QUOTED' | null
  pnlCostUsd: number | null
}

type Filter = 'ALL' | 'NONE' | 'DRAFT' | 'CHECKED' | 'FINAL' | 'LOSS' | 'UNPAID'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const monthRange = (offset: number) => {
  const now = new Date()
  const a = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
  const b = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0))
  return { from: iso(a), to: iso(b), label: a.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) }
}

function StatusPill({ header }: { header: ChecklistHeader | null }) {
  if (!header) return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"><CircleDashed className="w-3.5 h-3.5" /> Not started</span>
  const m = {
    DRAFT: { cls: 'bg-slate-100 text-slate-600', icon: CircleDashed, label: 'Draft' },
    CHECKED: { cls: 'bg-sky-50 text-sky-700', icon: CheckCircle2, label: 'Checked' },
    FINAL: { cls: 'bg-emerald-50 text-emerald-700', icon: Lock, label: 'Final' },
  }[header.status]
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', m.cls)}><m.icon className="w-3 h-3" /> {m.label}</span>
}

export default function ChecklistVnPage() {
  const { data: session } = useSession()
  const role = String(session?.user?.role ?? '')
  const [range, setRange] = useState(() => { const r = monthRange(0); return { from: r.from, to: r.to } })
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState<Filter>('ALL')
  const [rows, setRows] = useState<Row[]>([])
  const [installed, setInstalled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openRef, setOpenRef] = useState<string | null>(null)

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t) }, [q])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const sp = new URLSearchParams({ from: range.from, to: range.to })
      if (debounced.trim()) sp.set('q', debounced.trim())
      const res = await fetch(`/api/vn-checklist?${sp}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setRows(json.data.rows); setInstalled(json.data.installed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    } finally {
      setLoading(false)
    }
  }, [range, debounced])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => ({
    ALL: rows.length,
    NONE: rows.filter(r => !r.header).length,
    DRAFT: rows.filter(r => r.header?.status === 'DRAFT').length,
    CHECKED: rows.filter(r => r.header?.status === 'CHECKED').length,
    FINAL: rows.filter(r => r.header?.status === 'FINAL').length,
    LOSS: rows.filter(r => (r.totals.pnlIncurredVnd ?? 0) < 0).length,
    UNPAID: rows.filter(r => r.totals.outstandingVnd > 0).length,
  }), [rows])

  const shown = useMemo(() => rows.filter(r => {
    switch (filter) {
      case 'NONE': return !r.header
      case 'DRAFT': case 'CHECKED': case 'FINAL': return r.header?.status === filter
      case 'LOSS': return (r.totals.pnlIncurredVnd ?? 0) < 0
      case 'UNPAID': return r.totals.outstandingVnd > 0
      default: return true
    }
  }), [rows, filter])

  // Window totals over COSTED bookings only — revenue of an uncosted trip would read as pure margin.
  const agg = useMemo(() => {
    const costed = rows.filter(r => r.totals.totalEstimateVnd !== null && r.totals.totalVnd !== null)
    const revenue = costed.reduce((s, r) => s + (r.totals.totalVnd ?? 0), 0)
    const cost = costed.reduce((s, r) => s + (r.totals.totalEstimateVnd ?? 0), 0)
    const profit = revenue - cost
    return {
      costed: costed.length,
      revenue, cost, profit,
      margin: revenue > 0 ? profit / revenue : null,
      paid: rows.reduce((s, r) => s + r.totals.paidVnd, 0),
      outstanding: rows.reduce((s, r) => s + r.totals.outstandingVnd, 0),
    }
  }, [rows])

  if (session && !canViewChecklist(role)) {
    return (
      <>
        <Header title="Check List VN" />
        <div className="p-8 text-sm text-slate-500">The Vietnam checklist is not available for your role.</div>
      </>
    )
  }

  const months = [-1, 0, 1, 2].map(monthRange)
  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'ALL', label: 'All' }, { key: 'NONE', label: 'Not started' }, { key: 'DRAFT', label: 'Draft' },
    { key: 'CHECKED', label: 'Checked' }, { key: 'FINAL', label: 'Final' }, { key: 'LOSS', label: 'Under water' },
    { key: 'UNPAID', label: 'To pay' },
  ]

  return (
    <>
      <Header title="Check List VN" subtitle="Vietnam costing sheets — payables, vendors, PNL incurred and margin, booking by booking" />
      <div className="px-4 py-5 sm:px-8 sm:py-6 space-y-5">

        {/* Hero KPIs */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-600 via-red-600 to-amber-500 text-white p-5 shadow-lg">
          <div className="absolute -right-16 -top-20 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          <div className="relative grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {[
              { label: 'Bookings', value: rows.length, sub: `${agg.costed} costed`, icon: ListChecks },
              { label: 'Total VND (sold)', value: `₫ ${fmtVnd(agg.revenue)}`, sub: 'costed bookings', icon: Receipt },
              { label: 'Total estimate', value: `₫ ${fmtVnd(agg.cost)}`, sub: 'what they cost', icon: Wallet },
              { label: 'PNL incurred', value: `₫ ${fmtVnd(agg.profit)}`, sub: 'profit in dong', icon: agg.profit < 0 ? TrendingDown : TrendingUp },
              { label: 'Margin', value: fmtPct(agg.margin), sub: 'window, costed only', icon: Coins },
              { label: 'To pay', value: `₫ ${fmtVnd(agg.outstanding)}`, sub: `₫ ${fmtVnd(agg.paid)} paid`, icon: CircleDashed },
            ].map(k => (
              <div key={k.label} className="rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur px-4 py-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/80"><k.icon className="w-3.5 h-3.5" /> {k.label}</div>
                <div className="mt-1 text-xl font-bold tabular-nums truncate">{loading ? '…' : k.value}</div>
                <div className="text-[11px] text-white/75 truncate">{k.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {!installed && (
          <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-sm text-amber-800 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {CHECKLIST_NOT_INSTALLED}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-white ring-1 ring-slate-200 p-0.5">
            {months.map(m => (
              <button key={m.from} onClick={() => setRange({ from: m.from, to: m.to })}
                className={cn('px-3 py-1.5 text-xs font-semibold rounded-lg', range.from === m.from && range.to === m.to ? 'bg-rose-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50')}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 rounded-xl bg-white ring-1 ring-slate-200 px-2.5 py-1.5 text-xs text-slate-600">
            <CalendarRange className="w-3.5 h-3.5 text-slate-400" />
            <input type="date" value={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} className="bg-transparent outline-none" />
            <span className="text-slate-300">→</span>
            <input type="date" value={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} className="bg-transparent outline-none" />
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white ring-1 ring-slate-200 px-3 py-1.5 flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="VN number, agent or CNTL…" className="flex-1 text-sm bg-transparent outline-none" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('rounded-full px-3 py-1 text-xs font-semibold ring-1 transition',
                filter === f.key ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300',
                f.key === 'LOSS' && filter !== f.key && counts.LOSS > 0 && 'text-rose-600 ring-rose-200')}>
              {f.label} <span className="opacity-60 ml-0.5">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-x-auto">
          {loading ? (
            <div className="py-20 flex justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-rose-600">{error}</div>
          ) : shown.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">No Vietnam bookings match.</div>
          ) : (
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-slate-50 text-[10.5px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left py-2.5 pl-4">Booking</th>
                  <th className="text-left px-2">Arrival</th>
                  <th className="text-left px-2">Sheet</th>
                  <th className="text-right px-2">Revenue USD</th>
                  <th className="text-right px-2">Total VND</th>
                  <th className="text-right px-2">Total estimate</th>
                  <th className="text-right px-2">PNL incurred</th>
                  <th className="px-2 w-[160px]">Margin</th>
                  <th className="px-2 w-[130px]">Paid</th>
                  <th className="pr-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(r => {
                  const t = r.totals
                  const tone = marginTone(t.profitMargin)
                  const paid = t.totalEstimateVnd ? Math.min(1, t.paidVnd / t.totalEstimateVnd) : 0
                  return (
                    <tr key={r.booking.bookingRef} onClick={() => setOpenRef(r.booking.bookingRef)}
                      className={cn('cursor-pointer hover:bg-rose-50/40 transition-colors', r.booking.cancelled && 'opacity-50')}>
                      <td className="py-2.5 pl-4">
                        <div className="font-mono font-semibold text-slate-900">{r.booking.bookingRef}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{r.booking.agent ?? '—'} · {r.pax} pax{r.booking.cntlNumber ? ` · ${r.booking.cntlNumber}` : ''}</div>
                      </td>
                      <td className="px-2 text-xs text-slate-600 whitespace-nowrap">{r.booking.arrivalDate}</td>
                      <td className="px-2"><StatusPill header={r.header} /><div className="text-[10px] text-slate-400 mt-0.5">{t.itemCount} rows</div></td>
                      <td className="px-2 text-right tabular-nums">
                        {fmtUsd(t.revenueUsd)}
                        {r.header?.revenueUsdOverride !== null && r.header?.revenueUsdOverride !== undefined && <div className="text-[10px] text-amber-600">typed</div>}
                      </td>
                      <td className="px-2 text-right tabular-nums text-slate-700">{fmtVnd(t.totalVnd)}</td>
                      <td className="px-2 text-right tabular-nums text-slate-700">{fmtVnd(t.totalEstimateVnd)}</td>
                      <td className={cn('px-2 text-right tabular-nums font-semibold', tone === 'neg' ? 'text-rose-600' : tone === 'none' ? 'text-slate-400' : 'text-emerald-600')}>{fmtVnd(t.pnlIncurredVnd)}</td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className={cn('h-full rounded-full', tone === 'neg' ? 'bg-rose-500' : tone === 'thin' ? 'bg-amber-400' : 'bg-emerald-500')}
                              style={{ width: `${Math.min(100, Math.abs(t.profitMargin ?? 0) * 100 * 2)}%` }} />
                          </div>
                          <span className={cn('text-xs font-semibold tabular-nums w-12 text-right', tone === 'neg' ? 'text-rose-600' : tone === 'thin' ? 'text-amber-600' : tone === 'ok' ? 'text-emerald-600' : 'text-slate-400')}>{fmtPct(t.profitMargin)}</span>
                        </div>
                      </td>
                      <td className="px-2">
                        {t.itemCount > 0 ? (
                          <>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${paid * 100}%` }} /></div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{t.paidCount}/{t.itemCount} paid</div>
                          </>
                        ) : <span className="text-[11px] text-slate-300">—</span>}
                      </td>
                      <td className="pr-4 text-right">
                        <Link href={`/dashboard/bookings/${r.booking.bookingRef}`} onClick={e => e.stopPropagation()} className="text-slate-400 hover:text-rose-600" title="Open booking">
                          <ExternalLink className="w-4 h-4 inline" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {openRef && (
        <VnChecklistModal open bookingRef={openRef} role={role} onClose={() => setOpenRef(null)} onSaved={load} />
      )}
    </>
  )
}
