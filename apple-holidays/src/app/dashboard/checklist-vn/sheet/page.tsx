'use client'

/**
 * Checklist VN 2.1v — the board. Every tour on the desk's Excel checklist, as
 * mirrored into OPS: filter by month, agent, payment state; expand a tour to see
 * its payment lines; jump to the booking when OPS has it.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Search, Loader2, FileSpreadsheet, RefreshCw, Download, ChevronDown, ChevronRight, ArrowUpRight,
  Wallet, Receipt, TrendingUp, TrendingDown, Users, Database, AlertTriangle, ChevronLeft, Settings2,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { cn } from '@/lib/utils'
import { canViewChecklist } from '@/lib/vn-checklist/shared'
import {
  PAID_BUCKETS, codeStyle, fmtPct, fmtUsd, fmtVnd, timeAgo,
  type PaidBucket, type SheetLine, type SheetSyncInfo, type SheetTour,
} from '@/lib/vn-checklist-sheet/shared'

interface Board {
  installed: boolean
  message?: string
  tours: (SheetTour & { inOps: string[] })[]
  total: number
  page: number
  pageSize: number
  summary: {
    tours: number; pax: number; revenueUsd: number; totalVnd: number; totalEstimateVnd: number
    pnlIncurredVnd: number; margin: number | null; lines: number; paidLines: number; checkLines: number; openLines: number
  }
  agents: { agent: string; tours: number }[]
  lastSync: SheetSyncInfo | null
  lastSuccessAt: string | null
  refreshing: boolean
}

type Status = 'all' | 'open' | 'check' | 'settled' | 'loss'

const STATUS_TABS: [Status, string][] = [
  ['all', 'All tours'], ['open', 'Has unmarked lines'], ['check', 'Has “Check”'], ['settled', 'Fully paid'], ['loss', 'Loss-making'],
]

function monthOptions() {
  const out: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = -8; i <= 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
    out.push({
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    })
  }
  return out
}

export default function ChecklistVnSheetBoard() {
  const { data: session } = useSession()
  const role = session?.user?.role as string | undefined
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [status, setStatus] = useState<Status>('all')
  const [agent, setAgent] = useState('')
  const [sort, setSort] = useState('arrival')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const [lines, setLines] = useState<Record<string, SheetLine[]>>({})
  const months = useMemo(monthOptions, [])

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t) }, [q])
  useEffect(() => { setPage(1) }, [debounced, month, status, agent, sort])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const sp = new URLSearchParams({ q: debounced, month, status, agent, sort, page: String(page), pageSize: '50' })
      const res = await fetch(`/api/vn-checklist-sheet/tours?${sp}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.success) setBoard(json.data)
      else toast.error(json.error)
    } catch { toast.error('Could not load the board') } finally { if (!quiet) setLoading(false) }
  }, [debounced, month, status, agent, sort, page])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!board?.refreshing) return
    const t = setTimeout(() => { void load(true) }, 20_000)
    return () => clearTimeout(t)
  }, [board, load])

  async function toggle(code: string) {
    if (open === code) { setOpen(null); return }
    setOpen(code)
    if (!lines[code]) {
      const res = await fetch(`/api/vn-checklist-sheet/tours?tour=${encodeURIComponent(code)}`)
      const json = await res.json()
      if (json.success) setLines(prev => ({ ...prev, [code]: json.data.lines }))
    }
  }

  async function syncNow() {
    setSyncing(true)
    const t = toast.loading('Reading the Excel checklist…')
    try {
      const res = await fetch('/api/vn-checklist-sheet/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message, { id: t })
      setLines({})
      await load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed', { id: t })
    } finally { setSyncing(false) }
  }

  if (role && !canViewChecklist(role)) {
    return (<><Header title="Checklist VN 2.1" /><div className="p-8 text-sm text-slate-500">Not available for your role.</div></>)
  }

  const s = board?.summary
  const pages = board ? Math.max(1, Math.ceil(board.total / board.pageSize)) : 1

  return (
    <>
      <Header title="Checklist VN 2.1" subtitle="The VN desk's Excel checklist, mirrored into OPS every 2 hours — read-only" />
      <div className="space-y-5 px-4 py-5 sm:px-8 sm:py-6">

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-emerald-900 p-6 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-10 h-64 w-64 rounded-full bg-indigo-400/25 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                <FileSpreadsheet className="h-6 w-6 text-emerald-300" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-white/50">Checklist VN · 2.1v</p>
                <p className="text-2xl font-bold tabular-nums">{s ? s.tours.toLocaleString() : '—'} <span className="text-base font-medium text-white/60">tours</span></p>
                <p className="text-xs text-white/60">
                  {board?.refreshing || syncing ? 'Syncing with Excel…' : `Synced ${timeAgo(board?.lastSuccessAt)}`}
                  {board?.lastSync?.status === 'FAILED' && <span className="ml-1 text-rose-300">· last attempt failed</span>}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={syncNow} disabled={syncing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium ring-1 ring-white/15 transition hover:bg-white/20 disabled:opacity-60">
                <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} /> Sync now
              </button>
              <a href="/api/vn-checklist-sheet/download?kind=original" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-300">
                <Download className="h-3.5 w-3.5" /> Download Excel
              </a>
              {['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role ?? '') && (
                <Link href="/dashboard/admin/config#setting-vn-checklist21" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium ring-1 ring-white/15 hover:bg-white/20">
                  <Settings2 className="h-3.5 w-3.5" /> Settings
                </Link>
              )}
            </div>
          </div>

          {s && (
            <div className="relative mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
              {[
                { icon: Wallet, label: 'Revenue', value: fmtUsd(s.revenueUsd), sub: `${s.pax.toLocaleString()} pax` },
                { icon: Receipt, label: 'Total VND', value: fmtVnd(s.totalVnd, { compact: true }), sub: 'sold' },
                { icon: Receipt, label: 'Total estimate', value: fmtVnd(s.totalEstimateVnd, { compact: true }), sub: 'cost' },
                { icon: s.pnlIncurredVnd < 0 ? TrendingDown : TrendingUp, label: 'PNL incurred', value: fmtVnd(s.pnlIncurredVnd, { compact: true }), sub: `margin ${fmtPct(s.margin)}` },
                { icon: Users, label: 'Lines paid', value: s.lines ? `${Math.round((s.paidLines / s.lines) * 100)}%` : '—', sub: `${s.checkLines.toLocaleString()} on “Check”` },
              ].map(k => (
                <div key={k.label} className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10 backdrop-blur">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50"><k.icon className="h-3 w-3" />{k.label}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
                  <p className="text-[11px] text-white/50">{k.sub}</p>
                </div>
              ))}
            </div>
          )}
          {s && s.lines > 0 && (
            <div className="relative mt-4 flex h-2 overflow-hidden rounded-full bg-white/10">
              <div className="bg-emerald-400 transition-all duration-700" style={{ width: `${(s.paidLines / s.lines) * 100}%` }} />
              <div className="bg-amber-400 transition-all duration-700" style={{ width: `${(s.checkLines / s.lines) * 100}%` }} />
            </div>
          )}
        </div>

        {board && !board.installed && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
            <Database className="mt-0.5 h-4 w-4 shrink-0" /> {board.message}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-card">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tour code, agent, agent ref, itinerary…"
              className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />
          </label>
          <select value={month} onChange={e => setMonth(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm">
            <option value="">All arrivals</option>
            {months.map(m => <option key={m.value} value={m.value}>Arriving {m.label}</option>)}
          </select>
          <select value={agent} onChange={e => setAgent(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm">
            <option value="">All agents</option>
            {board?.agents.map(a => <option key={a.agent} value={a.agent}>{a.agent} ({a.tours})</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm">
            <option value="arrival">Arrival ↑</option>
            <option value="arrival_desc">Arrival ↓</option>
            <option value="pnl">Lowest PNL first</option>
            <option value="margin">Lowest margin first</option>
            <option value="changed">Recently changed</option>
          </select>
          <div className="flex w-full flex-wrap gap-1 pt-1">
            {STATUS_TABS.map(([k, label]) => (
              <button key={k} onClick={() => setStatus(k)}
                className={cn('rounded-full px-3 py-1 text-xs font-semibold transition',
                  status === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50/80 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-2 py-2.5">Tour</th>
                  <th className="px-2 py-2.5">Agent</th>
                  <th className="px-2 py-2.5">Dates</th>
                  <th className="px-2 py-2.5 text-right">Revenue</th>
                  <th className="px-2 py-2.5 text-right">Estimate</th>
                  <th className="px-2 py-2.5 text-right">PNL</th>
                  <th className="px-2 py-2.5">Margin</th>
                  <th className="px-2 py-2.5">Paid</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && !board?.tours?.length && (
                  <tr><td colSpan={10} className="py-14 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                )}
                {board?.tours?.map(t => {
                  const paid = t.lineCount ? t.paidLineCount / t.lineCount : 0
                  const check = t.lineCount ? t.checkLineCount / t.lineCount : 0
                  const m = t.profitMargin
                  const isOpen = open === t.tourCode
                  return (
                    <Fragment key={t.tourCode}>
                      <tr onClick={() => toggle(t.tourCode)} className={cn('cursor-pointer transition hover:bg-indigo-50/40', isOpen && 'bg-indigo-50/40', !t.isActive && 'opacity-60')}>
                        <td className="px-3 py-2.5 text-slate-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        <td className="px-2 py-2.5">
                          <p className="font-mono text-xs font-semibold text-slate-900">{t.tourCode}</p>
                          <p className="text-[11px] text-slate-400">{t.itinerary ?? '—'}{t.pax !== null ? ` · ${t.pax} pax` : ''}</p>
                        </td>
                        <td className="px-2 py-2.5">
                          <p className="text-xs text-slate-700">{t.agent ?? '—'}</p>
                          {t.agentRef && <p className="font-mono text-[10px] text-slate-400">{t.agentRef}</p>}
                        </td>
                        <td className="px-2 py-2.5 text-xs text-slate-600">{day(t.arrivalDate)} → {day(t.departureDate)}</td>
                        <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-700">{fmtUsd(t.revenueUsd)}</td>
                        <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-700">{fmtVnd(t.totalEstimateVnd, { compact: true })}</td>
                        <td className={cn('px-2 py-2.5 text-right text-xs font-semibold tabular-nums', (t.pnlIncurredVnd ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700')}>
                          {fmtVnd(t.pnlIncurredVnd, { compact: true })}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                              <div className={cn('h-full rounded-full', m === null ? '' : m < 0 ? 'bg-rose-500' : m < 0.1 ? 'bg-amber-400' : 'bg-emerald-500')}
                                style={{ width: `${Math.min(Math.abs(m ?? 0), 1) * 100}%` }} />
                            </div>
                            <span className="text-[11px] tabular-nums text-slate-600">{fmtPct(m)}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                              <div className="bg-emerald-500" style={{ width: `${paid * 100}%` }} />
                              <div className="bg-amber-400" style={{ width: `${check * 100}%` }} />
                            </div>
                            <span className="text-[11px] tabular-nums text-slate-500">{t.paidLineCount}/{t.lineCount}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                          {t.inOps[0] ? (
                            <Link href={`/dashboard/bookings/${t.inOps[0]}`} className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50">
                              Booking <ArrowUpRight className="h-3 w-3" />
                            </Link>
                          ) : <span className="text-[10px] text-slate-300">not in OPS</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={10} className="px-6 py-3">
                            {!lines[t.tourCode] ? (
                              <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading lines…</div>
                            ) : (
                              <div className="space-y-1">
                                {lines[t.tourCode].map(l => {
                                  const b = PAID_BUCKETS[l.paidBucket as PaidBucket] ?? PAID_BUCKETS.OPEN
                                  return (
                                    <div key={l.id} className="grid grid-cols-[80px_1fr_120px_110px_120px_110px] items-center gap-3 rounded-lg bg-white px-3 py-1.5 text-xs ring-1 ring-slate-100">
                                      <span className={cn('justify-self-start rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', codeStyle(l.code).tone)}>{l.code ?? '—'}</span>
                                      <span className="truncate text-slate-700" title={l.details}>{l.details}</span>
                                      <span className="truncate text-slate-500">{l.vendor ?? '—'}</span>
                                      <span className="text-right tabular-nums text-slate-500">{l.unitPrice?.toLocaleString('en-US') ?? '—'} × {l.quan1 ?? 1}{l.quan2 && l.quan2 !== 1 ? ` × ${l.quan2}` : ''}</span>
                                      <span className="text-right font-semibold tabular-nums text-slate-800">{fmtVnd(l.totalEstimateVnd)}</span>
                                      <span className={cn('justify-self-end rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', b.pill)}>{l.paidRaw || b.label}</span>
                                    </div>
                                  )
                                })}
                                <div className="flex justify-end gap-3 pt-1">
                                  <a href={`/api/vn-checklist-sheet/download?kind=mirror&tour=${encodeURIComponent(t.tourCode)}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline">
                                    <Download className="h-3 w-3" /> This tour (.xlsx)
                                  </a>
                                  {t.sheetRow && <span className="text-[11px] text-slate-400">{t.sheetTab}, row {t.sheetRow}</span>}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {board?.installed && !loading && !board.tours.length && (
                  <tr><td colSpan={10} className="py-14 text-center text-sm text-slate-400">
                    <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                    {board.lastSuccessAt ? 'No tours match these filters.' : 'Nothing synced yet — press Sync now.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {board && board.total > board.pageSize && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              <span>{((page - 1) * board.pageSize + 1).toLocaleString()}–{Math.min(page * board.pageSize, board.total).toLocaleString()} of {board.total.toLocaleString()}</span>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                <span className="px-2 py-1">{page} / {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function day(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}
