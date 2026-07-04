'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  RefreshCw, Link2, Unlink, Search, Loader2, CheckCircle2,
  AlertCircle, Clock, TrendingUp, TrendingDown, DollarSign,
  X, Database, ChevronDown, ChevronUp, Hash, Calendar,
  Users, Package, Tag, Globe, BarChart2, PlusCircle,
} from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PnlRecord {
  id: number
  sno: string | null
  vendor_name: string | null
  invoice_number: string | null
  is_number: string | null
  pnl_date: string | null
  invoice_date: string | null
  amount: number | null
  profit_loss: number | null
  total_pax: number | null
  total_nights: number | null
  actual_amount: number | null
  budget_amount: number | null
  process: string | null
  paid_amount: number | null
  exchange_rate: number | null
  gst: number | null
  currency: string | null
  category: string | null
  country_code: string | null
  status: string | null
  tour_ref: string | null
  agent_name: string | null
  start_date: string | null
  end_date: string | null
  control_number: string | null
  remarks: string | null
  pnl_month: string | null
  pnl_year: string | null
  update_status: string | null
  update_count: number | null
  created_at: string | null
  updated_at: string | null
}

interface PnlItem {
  id: number
  pnl_record_id: number
  control_number: string | null
  invoice_number: string | null
  type: string | null
  credit_type: string | null
  agent_name: string | null
  client_name: string | null
  check_in_date: string | null
  check_out_date: string | null
  hotel_name: string | null
  transport_name: string | null
  service_name: string | null
  country_code: string | null
  currency: string | null
  amount_original: number | null
  exchange_rate: number | null
  amount_converted: number | null
  item_details: string | null
  status: string | null
}

interface ExtPnlLink {
  id: string
  externalPnlId: number
  matchedBy: string
  matchedValue: string
  cachedRecord: PnlRecord
  cachedItems: PnlItem[]
  lastFetchedAt: string
  createdAt: string
}

interface Props {
  bookingRef: string
  role: UserRole
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MATCH_LABEL: Record<string, string> = {
  is_number:      'IS Number',
  tour_ref:       'Tour Ref',
  invoice_number: 'Invoice Number',
  manual:         'Manually linked',
}

function fmtAmt(n: number | null | undefined, cur = 'USD') {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: cur, minimumFractionDigits: 2,
  }).format(Number(n))
}

function extractRemarks(obj: Record<string, unknown>): string | null {
  const remark = obj.remarks ?? obj.remark ?? obj.note ?? obj.details
  if (typeof remark === 'string' && remark.trim()) return remark.trim()
  return null
}

function formatItemDetails(details: string | null | undefined | Record<string, unknown>) {
  if (details == null) return '—'

  // Prisma may return the Json field value as a parsed object
  if (typeof details === 'object') {
    return extractRemarks(details as Record<string, unknown>) ?? '—'
  }

  const raw = String(details).trim()
  if (!raw) return '—'

  try {
    let parsed: unknown = JSON.parse(raw)
    // First parse may return a string (double-encoded JSON) — parse once more
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { return parsed as string }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return extractRemarks(parsed as Record<string, unknown>) ?? raw
    }
  } catch {
    // Not JSON — return as-is
  }

  return raw
}

function statusColor(s: string | null): 'green' | 'yellow' | 'red' | 'gray' {
  if (!s) return 'gray'
  const l = s.toLowerCase()
  if (l.includes('paid') || l.includes('complet') || l.includes('done')) return 'green'
  if (l.includes('pend') || l.includes('process') || l.includes('partial'))  return 'yellow'
  if (l.includes('cancel') || l.includes('reject')) return 'red'
  return 'gray'
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-0.5">{label}</p>
      <p className={`text-xs font-medium text-slate-800 truncate ${mono ? 'font-mono' : ''}`}>
        {value ?? <span className="text-slate-300">—</span>}
      </p>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExternalPnlPanel({ bookingRef, role }: Props) {
  const [link, setLink]           = useState<ExtPnlLink | null | 'loading'>('loading')
  const [fetching, setFetching]   = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [showItems, setShowItems] = useState(true)

  // Manual search
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery]           = useState('')
  const [searching, setSearching]   = useState(false)
  const [results, setResults]       = useState<PnlRecord[]>([])
  const [linking, setLinking]       = useState<number | null>(null)
  const searchDebounce              = useRef<ReturnType<typeof setTimeout>>()

  const canEdit = ['AC_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  // Auto ticket creation state
  const [creatingAllTickets,  setCreatingAllTickets]  = useState(false)
  const [allTicketsResult,    setAllTicketsResult]    = useState<{ created: number; skipped: number } | null>(null)

  // Tally adjustment state
  const [adjustName,        setAdjustName]       = useState('PNL Reconciliation Adjustment')
  const [adjustAmount,      setAdjustAmount]     = useState('')
  const [addingAdjust,      setAddingAdjust]     = useState(false)
  const [addedAdjustments,  setAddedAdjustments] = useState<{ name: string; amount: number }[]>([])

  // ── Tally adjustment ──────────────────────────────────────────────────────
  async function addAdjustmentToPnl(amount: number) {
    if (!adjustName.trim() || !amount) return
    setAddingAdjust(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/pnl`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity: adjustName.trim(), category: 'OTHER', otherRate: Math.abs(amount) }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setAddedAdjustments(prev => [...prev, { name: adjustName.trim(), amount: Math.abs(amount) }])
      toast.success('Adjustment line added to internal P&L')
      setAdjustAmount('')
      setAdjustName('PNL Reconciliation Adjustment')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add adjustment')
    } finally {
      setAddingAdjust(false)
    }
  }

  // ── Bulk create tickets from PNL ────────────────────────────────────────
  const createAllTicketsFromPnl = useCallback(async (silent = false) => {
    if (!canEdit) return
    setCreatingAllTickets(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/ext-pnl/create-tickets`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const { created, skipped } = json.data as { created: number; skipped: number }
      setAllTicketsResult({ created, skipped })
      // Also mark those items as created in per-item state
      if (created > 0) {
        if (!silent) toast.success(`${created} ticket${created !== 1 ? 's' : ''} created from PNL`)
        else         toast.success(`${created} ticket${created !== 1 ? 's' : ''} auto-created from linked PNL`)
      } else if (!silent) {
        toast.info('All PNL items already have tickets')
      }
    } catch (err) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'Failed to create tickets')
    } finally {
      setCreatingAllTickets(false)
    }
  }, [bookingRef, canEdit])

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadLink = useCallback(async () => {
    setLink('loading')
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/ext-pnl`)
      const json = await res.json()
      setLink(json.success ? json.data : null)
    } catch {
      setLink(null)
    }
  }, [bookingRef])

  useEffect(() => { loadLink() }, [loadLink])

  // ── Refetch ───────────────────────────────────────────────────────────────
  async function refetch() {
    setFetching(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/ext-pnl/fetch`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setLink(json.data)
      toast.success('Accounts PNL refreshed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed')
    } finally { setFetching(false) }
  }

  // ── Unlink ────────────────────────────────────────────────────────────────
  async function unlink() {
    if (!confirm('Remove the Accounts PNL link from this booking?')) return
    setUnlinking(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/ext-pnl`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setLink(null)
      toast.success('PNL link removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unlink failed')
    } finally { setUnlinking(false) }
  }

  // ── Search ────────────────────────────────────────────────────────────────
  function handleQueryChange(val: string) {
    setQuery(val)
    clearTimeout(searchDebounce.current)
    if (val.trim().length < 2) { setResults([]); return }
    searchDebounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/bookings/${bookingRef}/ext-pnl/search?q=${encodeURIComponent(val)}`)
        const json = await res.json()
        setResults(json.success ? json.data : [])
      } catch { setResults([]) }
      finally  { setSearching(false) }
    }, 450)
  }

  // ── Manual link ───────────────────────────────────────────────────────────
  async function manualLink(externalPnlId: number) {
    setLinking(externalPnlId)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/ext-pnl/link`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ externalPnlId }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setLink(json.data)
      setSearchOpen(false)
      setQuery('')
      setResults([])
      toast.success('Accounts PNL linked')
      // Auto-create tickets from PNL items on first link
      await createAllTicketsFromPnl(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed')
    } finally { setLinking(null) }
  }

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (link === 'loading') {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Fetching Accounts PNL data…</span>
        </div>
      </Card>
    )
  }

  const rec   = (link as ExtPnlLink | null)?.cachedRecord
  const items = (link as ExtPnlLink | null)?.cachedItems ?? []
  const cur   = rec?.currency ?? 'USD'

  // ─── Linked state ─────────────────────────────────────────────────────────
  if (link && rec) {
    const pl = Number(rec.profit_loss ?? 0)
    return (
      <Card>
        {/* Header */}
        <CardHeader
          action={
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-medium">
                <Clock className="w-3 h-3 inline mr-1" />
                {formatDateTime((link as ExtPnlLink).lastFetchedAt)}
              </span>
              {canEdit && items.length > 0 && (
                <button
                  onClick={() => createAllTicketsFromPnl(false)}
                  disabled={creatingAllTickets}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                  title="Create booking tickets for all PNL line items (skips already-created)"
                >
                  {creatingAllTickets
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <PlusCircle className="w-3 h-3" />}
                  {allTicketsResult
                    ? `Tickets (${allTicketsResult.created} created)`
                    : 'Create All Tickets'}
                </button>
              )}
              <button
                onClick={refetch}
                disabled={fetching}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                {fetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Refetch
              </button>
              {canEdit && (
                <button
                  onClick={unlink}
                  disabled={unlinking}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  {unlinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                  Unlink
                </button>
              )}
            </div>
          }
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Database className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-900">Accounts PNL Record #{rec.id}</h3>
            <Badge color="green">Linked</Badge>
            <span className="text-[11px] text-slate-400">
              via <strong className="text-slate-600">{MATCH_LABEL[(link as ExtPnlLink).matchedBy] ?? (link as ExtPnlLink).matchedBy}</strong>
              {' · '}<code className="bg-slate-100 px-1 rounded">{(link as ExtPnlLink).matchedValue}</code>
            </span>
          </div>
        </CardHeader>

        <div className="p-5 space-y-5">

          {/* ── Financial summary row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3.5">
              <div className="flex items-center gap-1.5 text-blue-600 mb-1">
                <DollarSign className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wide">Actual Amount</span>
              </div>
              <p className="text-sm font-bold text-blue-800">{fmtAmt(rec.actual_amount, cur)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
              <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                <BarChart2 className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wide">Budget Amount</span>
              </div>
              <p className="text-sm font-bold text-slate-700">{fmtAmt(rec.budget_amount, cur)}</p>
            </div>
            <div className={`rounded-xl border p-3.5 ${pl >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
              <div className={`flex items-center gap-1.5 mb-1 ${pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {pl >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span className="text-[10px] font-bold uppercase tracking-wide">Profit / Loss</span>
              </div>
              <p className={`text-sm font-bold ${pl >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtAmt(rec.profit_loss, cur)}</p>
            </div>
            <div className="rounded-xl bg-purple-50 border border-purple-100 p-3.5">
              <div className="flex items-center gap-1.5 text-purple-600 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wide">Paid Amount</span>
              </div>
              <p className="text-sm font-bold text-purple-700">{fmtAmt(rec.paid_amount, cur)}</p>
            </div>
          </div>

          {/* ── Full record details ── */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
            <h4 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5" /> PNL Record Details
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Field label="IS Number"      value={rec.is_number}      mono />
              <Field label="Tour Ref"       value={rec.tour_ref}       mono />
              <Field label="Invoice No"     value={rec.invoice_number} mono />
              <Field label="Control No"     value={rec.control_number} mono />
              <Field label="SNO"            value={rec.sno}            mono />
              <Field label="Vendor"         value={rec.vendor_name} />
              <Field label="Agent"          value={rec.agent_name} />
              <Field label="Category"       value={rec.category} />
              <Field label="Country"        value={rec.country_code} />
              <Field label="Currency"       value={rec.currency} />
              <Field label="PNL Date"       value={rec.pnl_date} />
              <Field label="Invoice Date"   value={rec.invoice_date} />
              <Field label="Start Date"     value={rec.start_date} />
              <Field label="End Date"       value={rec.end_date} />
              <Field label="Month / Year"   value={rec.pnl_month ? `${rec.pnl_month} / ${rec.pnl_year ?? ''}` : null} />
              <Field label="Total Pax"      value={rec.total_pax} />
              <Field label="Total Nights"   value={rec.total_nights} />
              <Field label="Exchange Rate"  value={rec.exchange_rate} />
              <Field label="GST"            value={rec.gst != null ? fmtAmt(rec.gst, cur) : null} />
              <Field label="Amount"         value={rec.amount != null ? fmtAmt(rec.amount, cur) : null} />
              <Field label="Process"        value={rec.process} />
              <Field label="Update Status"  value={rec.update_status} />
              <Field label="Update Count"   value={rec.update_count} />
              <Field label="Status"         value={
                rec.status
                  ? <Badge color={statusColor(rec.status)}>{rec.status}</Badge>
                  : null
              } />
              <Field label="Last Updated"   value={rec.updated_at ? formatDateTime(rec.updated_at) : null} />
            </div>
          </div>

          {/* ── Remarks ── */}
          {rec.remarks && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-700">Remarks</p>
                <p className="text-sm text-amber-900 mt-0.5">{rec.remarks}</p>
              </div>
            </div>
          )}

          {/* ── PNL Items ── */}
          {(() => {
            const invoiceRows = items.filter(it => it.type?.toUpperCase() === 'INVOICE')
            const lineRows    = items.filter(it => it.type?.toUpperCase() !== 'INVOICE')
            const lineSum     = lineRows.reduce((s, it) => s + Number(it.amount_original ?? 0), 0)
            const invoiceTotal = invoiceRows.length > 0
              ? invoiceRows.reduce((s, it) => s + Number(it.amount_original ?? 0), 0)
              : rec.actual_amount != null ? Number(rec.actual_amount) : null
            const gap = invoiceTotal != null ? invoiceTotal - lineSum : null

            // Track adjustments added this session so the remaining gap updates live
            const sessionAdjTotal = addedAdjustments.reduce((s, a) => s + a.amount, 0)
            const remainingGap    = gap != null ? gap - sessionAdjTotal : null
            const adjustVal       = Number(adjustAmount) || (remainingGap != null ? Math.abs(remainingGap) : 0)

            return (
              <div className="space-y-0">
                <button
                  onClick={() => setShowItems(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 mb-3"
                >
                  <Package className="w-3.5 h-3.5 text-slate-400" />
                  PNL Line Items
                  <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {lineRows.length}
                  </span>
                  {showItems ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
                </button>

                {showItems && (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="data-table text-xs">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Type</th>
                          <th>Credit Type</th>
                          <th>Service / Hotel / Transport</th>
                          <th>Currency</th>
                          <th className="text-right">Original Amt</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineRows.length === 0 && (
                          <tr><td colSpan={7} className="text-center text-slate-400 py-4">No line items found</td></tr>
                        )}
                        {lineRows.map((item, i) => (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="font-mono text-slate-400">{i + 1}</td>
                            <td>{item.type ?? '—'}</td>
                            <td>{item.credit_type ?? '—'}</td>
                            <td className="max-w-[200px] truncate font-medium">
                              {item.hotel_name ?? item.transport_name ?? item.service_name ?? '—'}
                            </td>
                            <td>{item.currency ?? '—'}</td>
                            <td className="text-right font-mono font-semibold">
                              {item.amount_original != null ? Number(item.amount_original).toFixed(2) : '—'}
                            </td>
                            <td className="max-w-[220px] truncate text-slate-500" title={formatItemDetails(item.item_details as string | null)}>
                              {formatItemDetails(item.item_details as string | null)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Sub-total row */}
                      {lineRows.length > 0 && (
                        <tfoot>
                          <tr className="bg-slate-50 border-t-2 border-slate-200">
                            <td colSpan={5} className="px-3 py-2 text-xs font-bold text-slate-600 text-right">Sub-total</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">{lineSum.toFixed(2)}</td>
                            <td />
                          </tr>
                          {/* INVOICE / Total rows pinned at bottom */}
                          {invoiceRows.map(inv => (
                            <tr key={inv.id} className="bg-blue-50 border-t border-blue-200">
                              <td colSpan={5} className="px-3 py-2 text-xs font-bold text-blue-700 text-right uppercase tracking-wide">
                                {inv.service_name ?? inv.hotel_name ?? inv.transport_name ?? 'Total'}
                                <span className="ml-2 text-[10px] font-semibold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">INVOICE</span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-blue-800 text-sm">
                                {inv.amount_original != null ? Number(inv.amount_original).toFixed(2) : '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-blue-500 truncate max-w-[220px]">
                                {formatItemDetails(inv.item_details as string | null)}
                              </td>
                            </tr>
                          ))}
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}

                {/* ── Tally Reconciliation ── */}
                {invoiceTotal != null && gap != null && Math.abs(remainingGap ?? gap) >= 0.005 && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-bold">Tally Difference</span>
                      </div>
                      {Math.abs(remainingGap ?? gap) < 0.005 && (
                        <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Balanced
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <p className="text-amber-500 font-semibold">Invoice Total</p>
                        <p className="font-bold text-blue-800">{fmtAmt(invoiceTotal, cur)}</p>
                        <p className="text-[10px] text-amber-400 mt-0.5">Fixed — cannot change</p>
                      </div>
                      <div>
                        <p className="text-amber-500 font-semibold">Sum of Items</p>
                        <p className="font-bold text-slate-800">{fmtAmt(lineSum, cur)}</p>
                      </div>
                      <div>
                        <p className="text-amber-500 font-semibold">Gap</p>
                        <p className={`font-bold text-sm ${(remainingGap ?? gap) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {(remainingGap ?? gap) >= 0 ? '+' : ''}{fmtAmt(remainingGap ?? gap, cur)}
                        </p>
                      </div>
                    </div>

                    {/* Already-added adjustments this session */}
                    {addedAdjustments.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-amber-200">
                        <p className="text-[11px] font-semibold text-amber-600">Added this session:</p>
                        {addedAdjustments.map((a, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] bg-white border border-amber-100 rounded px-2 py-1">
                            <span className="text-slate-700">{a.name}</span>
                            <span className="font-mono font-semibold text-emerald-700">{fmtAmt(a.amount, cur)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {canEdit && Math.abs(remainingGap ?? gap) >= 0.005 && (
                      <div className="space-y-2 pt-1 border-t border-amber-200">
                        <p className="text-[11px] text-amber-700 font-medium">
                          Add adjustment line(s) to internal P&amp;L — remaining gap:
                          <span className={`ml-1 font-bold ${(remainingGap ?? gap) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                            {fmtAmt(remainingGap ?? gap, cur)}
                          </span>
                        </p>
                        <div className="flex gap-2">
                          <input
                            value={adjustName}
                            onChange={e => setAdjustName(e.target.value)}
                            placeholder="Adjustment label"
                            className="form-input flex-1 text-xs py-1.5"
                          />
                          <input
                            value={adjustAmount}
                            onChange={e => setAdjustAmount(e.target.value)}
                            placeholder={remainingGap != null ? Math.abs(remainingGap).toFixed(2) : '0.00'}
                            type="number"
                            min="0"
                            step="0.01"
                            className="form-input w-28 text-xs py-1.5 font-mono"
                          />
                          <button
                            onClick={() => addAdjustmentToPnl(adjustVal)}
                            disabled={addingAdjust || !adjustName.trim() || adjustVal <= 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors flex-shrink-0"
                          >
                            {addingAdjust
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <PlusCircle className="w-3.5 h-3.5" />}
                            Add to P&amp;L
                          </button>
                        </div>
                      </div>
                    )}

                    {canEdit && Math.abs(remainingGap ?? gap) < 0.005 && (
                      <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1 pt-1 border-t border-amber-200">
                        <CheckCircle2 className="w-3.5 h-3.5" /> All adjustments added — internal P&amp;L is now balanced.
                      </p>
                    )}
                  </div>
                )}

                {invoiceTotal != null && gap != null && Math.abs(gap) < 0.005 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Items tally with invoice total — no adjustment needed.
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Summary pills ── */}
          <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
            {rec.total_pax != null && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-1 rounded-full">
                <Users className="w-3 h-3" /> {rec.total_pax} pax
              </span>
            )}
            {rec.total_nights != null && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-1 rounded-full">
                <Calendar className="w-3 h-3" /> {rec.total_nights} nights
              </span>
            )}
            {rec.category && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-1 rounded-full">
                <Tag className="w-3 h-3" /> {rec.category}
              </span>
            )}
            {rec.country_code && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-1 rounded-full">
                <Globe className="w-3 h-3" /> {rec.country_code}
              </span>
            )}
            {rec.process && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-1 rounded-full">
                <Package className="w-3 h-3" /> {rec.process}
              </span>
            )}
          </div>
        </div>
      </Card>
    )
  }

  // ─── Not linked state ─────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader
        action={canEdit ? (
          <button
            onClick={() => setSearchOpen(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" />
            Link PNL Manually
          </button>
        ) : null}
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-300" />
          <h3 className="text-sm font-bold text-slate-900">Accounts PNL Record</h3>
          <Badge color="gray">Not Linked</Badge>
        </div>
      </CardHeader>

      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
          <AlertCircle className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-700">No Accounts PNL record linked</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Auto-match was attempted using IS Number, Tour Ref, and Invoice Number — no match found.
              Search below to manually link a record.
            </p>
          </div>
        </div>

        {canEdit && (
          <button
            onClick={() => setSearchOpen(v => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            <Search className="w-4 h-4" />
            {searchOpen ? 'Hide search' : 'Search & link a PNL record'}
          </button>
        )}
      </div>

      {/* Search panel */}
      {canEdit && searchOpen && (
        <div className="border-t border-slate-100 p-5 space-y-3 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                placeholder="Search by IS number, tour ref, invoice, vendor, agent…"
                className="form-input pl-9 text-sm w-full"
              />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />}
            </div>
            <button onClick={() => { setSearchOpen(false); setQuery(''); setResults([]) }}>
              <X className="w-5 h-5 text-slate-400 hover:text-slate-600" />
            </button>
          </div>

          {results.length > 0 && (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {results.map(r => (
                <div key={r.id} className="flex items-start justify-between gap-3 p-3 bg-white rounded-lg border border-slate-200 hover:border-brand-300 transition-colors">
                  <div className="min-w-0 flex-1 text-xs space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800">#{r.id}</span>
                      {r.is_number      && <code className="bg-blue-50 text-blue-700 px-1 rounded">{r.is_number}</code>}
                      {r.tour_ref       && <code className="bg-slate-100 px-1 rounded">{r.tour_ref}</code>}
                      {r.control_number && <code className="bg-purple-50 text-purple-700 px-1 rounded">{r.control_number}</code>}
                      {r.status && <Badge color={statusColor(r.status)}>{r.status}</Badge>}
                    </div>
                    <p className="text-slate-600">{r.vendor_name ?? '—'}{r.agent_name ? ` · ${r.agent_name}` : ''}</p>
                    <p className="text-slate-400 font-mono">
                      {r.invoice_number ?? ''}
                      {r.pnl_date ? ` · ${r.pnl_date}` : ''}
                      {r.actual_amount != null ? ` · ${fmtAmt(r.actual_amount, r.currency ?? 'USD')}` : ''}
                    </p>
                  </div>
                  <Button size="sm" loading={linking === r.id} onClick={() => manualLink(r.id)} icon={<Link2 className="w-3.5 h-3.5" />}>
                    Link
                  </Button>
                </div>
              ))}
            </div>
          )}

          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-3">No records found for &quot;{query}&quot;</p>
          )}
          {query.trim().length < 2 && (
            <p className="text-xs text-slate-400 text-center py-2">Type at least 2 characters to search</p>
          )}
        </div>
      )}
    </Card>
  )
}
