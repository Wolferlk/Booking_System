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

function formatItemDetails(details: string | null | undefined) {
  if (!details) return '—'

  const raw = details.trim()
  if (!raw) return '—'

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const remark = parsed.remarks ?? parsed.remark ?? parsed.note ?? parsed.details
      if (typeof remark === 'string' && remark.trim()) return remark.trim()
    }
  } catch {
    // Not JSON, fall through to the raw string
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
          <div>
            <button
              onClick={() => setShowItems(v => !v)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 mb-3"
            >
              <Package className="w-3.5 h-3.5 text-slate-400" />
              PNL Line Items
              <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {items.length}
              </span>
              {showItems ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
            </button>

            {showItems && items.length > 0 && (
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
                    {items.map((item, i) => (
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
                        <td className="max-w-[220px] truncate text-slate-500" title={formatItemDetails(item.item_details)}>
                          {formatItemDetails(item.item_details)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Totals row */}
                  {items.length > 0 && (() => {
                    const sumOrig = items.reduce((s, i) => s + Number(i.amount_original ?? 0), 0)
                    return (
                      <tfoot>
                        <tr className="bg-slate-100 font-bold text-xs">
                          <td colSpan={4} className="px-4 py-2 text-right text-slate-600">TOTAL</td>
                          <td className="text-right font-mono">{sumOrig.toFixed(2)}</td>
                          <td />
                          <td />
                        </tr>
                      </tfoot>
                    )
                  })()}
                </table>
              </div>
            )}

            {showItems && items.length === 0 && (
              <p className="text-xs text-slate-400 py-3 pl-1">No line items found for this PNL record.</p>
            )}
          </div>

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
