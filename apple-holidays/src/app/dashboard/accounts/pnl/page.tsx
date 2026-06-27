'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Loader2, Database, Link2, Unlink, Search, RefreshCw,
  AlertCircle, CheckCircle2, Clock, TrendingUp, TrendingDown,
  ChevronRight, X, DollarSign, Users, Calendar, Hash,
  FileText, ArrowRight, Eye,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PnlRecord {
  id: number
  is_number: string | null
  tour_ref: string | null
  invoice_number: string | null
  control_number: string | null
  vendor_name: string | null
  agent_name: string | null
  pnl_date: string | null
  start_date: string | null
  end_date: string | null
  category: string | null
  country_code: string | null
  currency: string | null
  status: string | null
  actual_amount: number | null
  budget_amount: number | null
  profit_loss: number | null
  paid_amount: number | null
  total_pax: number | null
  total_nights: number | null
  process: string | null
  remarks: string | null
  update_count: number | null
  created_at: string | null
  updated_at: string | null
}

interface BookingSnap {
  id: string
  bookingRef: string
  isNumber: string | null
  agent: string | null
  dealName: string | null
  agentBookingId: string | null
  status: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: string | null
  currency: string
  operationCountry: string | null
  passengers: { name: string }[]
}

interface LinkMeta {
  id: string
  matchedBy: string
  matchedValue: string
  lastFetchedAt: string
  createdAt: string
}

interface LinkedRow {
  pnlRecord: PnlRecord
  link: LinkMeta
  booking: BookingSnap
}

interface OverviewData {
  summary: { totalExtPnl: number; linked: number; pnlOnly: number; bookingsOnly: number }
  linked: LinkedRow[]
  pnlOnly: PnlRecord[]
  bookingsOnly: BookingSnap[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, currency = 'USD') {
  if (n == null || n === 0) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(Number(n))
}

function pnlStatusColor(status: string | null): 'green' | 'yellow' | 'red' | 'gray' {
  if (!status) return 'gray'
  const s = status.toLowerCase()
  if (s.includes('paid') || s.includes('complete') || s.includes('done')) return 'green'
  if (s.includes('pend') || s.includes('process') || s.includes('partial')) return 'yellow'
  if (s.includes('cancel') || s.includes('reject')) return 'red'
  return 'gray'
}

function MatchBadge({ by }: { by: string }) {
  const labels: Record<string, string> = {
    is_number: 'IS#', tour_ref: 'Tour Ref', invoice_number: 'Invoice', manual: 'Manual',
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
      {labels[by] ?? by}
    </span>
  )
}

function PnlAmountCell({ record }: { record: PnlRecord }) {
  const pl = Number(record.profit_loss ?? 0)
  return (
    <div className="text-xs space-y-0.5">
      {record.actual_amount != null && (
        <div className="font-semibold text-slate-800">{fmt(record.actual_amount, record.currency ?? 'USD')}</div>
      )}
      {record.profit_loss != null && (
        <div className={`flex items-center gap-0.5 font-medium ${pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {pl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {fmt(record.profit_loss, record.currency ?? 'USD')}
        </div>
      )}
    </div>
  )
}

// ─── Tab config ──────────────────────────────────────────────────────────────

type Tab = 'linked' | 'pnl_only' | 'bookings_only'

// ─── Assign-booking modal ─────────────────────────────────────────────────────

function AssignBookingModal({
  pnlRecord,
  onClose,
  onLinked,
}: {
  pnlRecord: PnlRecord
  onClose: () => void
  onLinked: () => void
}) {
  const [q, setQ]           = useState('')
  const [results, setResults] = useState<BookingSnap[]>([])
  const [searching, setSearching] = useState(false)
  const [linking, setLinking]     = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  function handleSearch(val: string) {
    setQ(val)
    clearTimeout(debounce.current)
    if (val.trim().length < 2) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/bookings?search=${encodeURIComponent(val)}&limit=20`)
        const json = await res.json()
        setResults(json.success ? json.data.bookings : [])
      } catch { setResults([]) }
      finally  { setSearching(false) }
    }, 400)
  }

  async function link(bookingRef: string) {
    setLinking(bookingRef)
    try {
      const res  = await fetch('/api/accounts/pnl-link', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ externalPnlId: pnlRecord.id, bookingRef }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(`PNL #${pnlRecord.id} linked to ${bookingRef}`)
      onLinked()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed')
    } finally { setLinking(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Assign Booking to PNL #{pnlRecord.id}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {pnlRecord.is_number && <span className="mr-2">IS: <code>{pnlRecord.is_number}</code></span>}
              {pnlRecord.tour_ref  && <span className="mr-2">Ref: <code>{pnlRecord.tour_ref}</code></span>}
              {pnlRecord.vendor_name && <span>{pnlRecord.vendor_name}</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search by booking ref, IS number, agent, passenger…"
              className="form-input pl-9 text-sm w-full"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
          {results.length === 0 && q.trim().length >= 2 && !searching && (
            <p className="text-sm text-slate-400 text-center py-8">No bookings found for &quot;{q}&quot;</p>
          )}
          {results.length === 0 && q.trim().length < 2 && (
            <p className="text-xs text-slate-400 text-center py-8">Type at least 2 characters to search</p>
          )}
          {results.map(b => {
            const lead = b.passengers[0]?.name ?? '—'
            return (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="flex-1 min-w-0 text-xs space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-bold text-slate-800">{b.bookingRef}</code>
                    {b.isNumber && <span className="text-blue-600 font-mono">{b.isNumber}</span>}
                    <StatusBadge status={b.status as never} />
                  </div>
                  <div className="text-slate-500">{lead} · {b.agent ?? '—'}</div>
                  <div className="text-slate-400">{formatDate(b.arrivalDate)}</div>
                </div>
                <button
                  onClick={() => link(b.bookingRef)}
                  disabled={linking === b.bookingRef}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {linking === b.bookingRef
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Link2 className="w-3.5 h-3.5" />
                  }
                  Link
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AccountsPNLPage() {
  const router  = useRouter()
  const { data: session } = useSession()
  const role = session?.user?.role ?? ''

  const [data, setData]         = useState<OverviewData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dbError, setDbError]   = useState<string | null>(null)
  const [tab, setTab]           = useState<Tab>('linked')
  const [search, setSearch]     = useState('')
  const [assignTarget, setAssignTarget] = useState<PnlRecord | null>(null)
  const [unlinking, setUnlinking]       = useState<string | null>(null)

  const searchDebounce = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async (q = '', silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setDbError(null)
    try {
      const qs  = q ? `&search=${encodeURIComponent(q)}` : ''
      const res  = await fetch(`/api/accounts/pnl-overview?limit=300${qs}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setData(json.data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load PNL overview'
      setDbError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSearch(val: string) {
    setSearch(val)
    clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => load(val, true), 500)
  }

  async function unlink(bookingRef: string) {
    if (!confirm(`Remove PNL link from ${bookingRef}?`)) return
    setUnlinking(bookingRef)
    try {
      const res  = await fetch('/api/accounts/pnl-link', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bookingRef }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(`PNL unlinked from ${bookingRef}`)
      load(search, true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unlink failed')
    } finally {
      setUnlinking(null) }
  }

  // ── Tab data ──────────────────────────────────────────────────────────────
  const linked       = data?.linked       ?? []
  const pnlOnly      = data?.pnlOnly      ?? []
  const bookingsOnly = data?.bookingsOnly ?? []
  const summary      = data?.summary

  const TAB_CONFIG: { key: Tab; label: string; count: number; color: string }[] = [
    { key: 'linked',       label: 'Linked PNL',               count: linked.length,       color: 'emerald' },
    { key: 'pnl_only',    label: 'PNL — No Booking',          count: pnlOnly.length,      color: 'amber'   },
    { key: 'bookings_only', label: 'Bookings — No PNL',        count: bookingsOnly.length, color: 'rose'    },
  ]

  const tabColor: Record<Tab, string> = {
    linked:        'border-emerald-500 text-emerald-700 bg-emerald-50',
    pnl_only:      'border-amber-500   text-amber-700   bg-amber-50',
    bookings_only: 'border-rose-500    text-rose-700    bg-rose-50',
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div>
      <Header
        title="Accounts PNL Overview"
        subtitle="External PNL database matched against bookings"
        actions={
          <button
            onClick={() => load(search, true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        }
      />

      <div className="p-8 space-y-6 max-w-screen-2xl">

        {/* ── Accounts DB error banner ── */}
        {dbError && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-700">Accounts Database Unavailable</p>
              <p className="text-xs text-red-600 mt-0.5">{dbError}</p>
            </div>
            <button
              onClick={() => load(search, true)}
              className="text-xs font-semibold text-red-700 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Summary cards ── */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Accounts PNL', value: summary.totalExtPnl, icon: <Database className="w-5 h-5" />, color: 'blue'    },
              { label: 'Linked to Bookings', value: summary.linked,      icon: <CheckCircle2 className="w-5 h-5" />, color: 'emerald' },
              { label: 'PNL — No Booking',   value: summary.pnlOnly,     icon: <AlertCircle className="w-5 h-5" />, color: 'amber'   },
              { label: 'Bookings — No PNL',  value: summary.bookingsOnly, icon: <FileText className="w-5 h-5" />, color: 'rose'    },
            ].map(s => {
              const clr: Record<string, string> = {
                blue:    'bg-blue-50    border-blue-100   text-blue-600',
                emerald: 'bg-emerald-50 border-emerald-100 text-emerald-600',
                amber:   'bg-amber-50   border-amber-100  text-amber-600',
                rose:    'bg-rose-50    border-rose-100   text-rose-600',
              }
              return (
                <div key={s.label} className={`rounded-2xl border p-5 ${clr[s.color]}`}>
                  <div className="flex items-center gap-2 mb-2 opacity-70">{s.icon}
                    <span className="text-xs font-semibold uppercase tracking-wide">{s.label}</span>
                  </div>
                  <p className="text-3xl font-bold">{s.value}</p>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Search bar ── */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Filter by IS number, tour ref, invoice, vendor, agent…"
            className="form-input pl-9 text-sm w-full"
          />
          {refreshing && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />}
          {search && !refreshing && (
            <button onClick={() => { setSearch(''); load('', true) }} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
            </button>
          )}
        </div>

        {/* ── Tab bar ── */}
        <div className="flex gap-2 border-b border-slate-200">
          {TAB_CONFIG.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                tab === t.key
                  ? tabColor[t.key]
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                tab === t.key ? '' : 'bg-slate-100 text-slate-600'
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* ══════════════ CONTENT ══════════════ */}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-7 h-7 text-brand-500 animate-spin" />
          </div>
        ) : (

          <>
            {/* ── TAB: Linked ── */}
            {tab === 'linked' && (
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Linked PNL Records
                    <span className="text-xs text-slate-400 font-normal">— matched to a booking · ordered by latest created</span>
                  </h3>
                </CardHeader>
                {linked.length === 0 ? (
                  <CardBody className="py-16 text-center text-slate-400">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No linked PNL records found</p>
                  </CardBody>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table text-xs">
                      <thead>
                        <tr>
                          <th>PNL ID</th>
                          <th>IS Number</th>
                          <th>Tour Ref / Invoice</th>
                          <th>Vendor / Agent</th>
                          <th>Dates</th>
                          <th>Amounts</th>
                          <th>PNL Status</th>
                          <th>Booking Ref</th>
                          <th>Lead Passenger</th>
                          <th>Arrival</th>
                          <th>Booking Status</th>
                          <th>Matched By</th>
                          <th>Last Fetched</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {linked.map(row => {
                          const lead = row.booking.passengers[0]?.name ?? '—'
                          return (
                            <tr key={row.link.id}>
                              <td className="font-mono font-bold text-slate-700">#{row.pnlRecord.id}</td>
                              <td>
                                {row.pnlRecord.is_number
                                  ? <span className="font-mono font-bold text-blue-700">{row.pnlRecord.is_number}</span>
                                  : <span className="text-slate-300">—</span>}
                              </td>
                              <td>
                                <div className="space-y-0.5">
                                  {row.pnlRecord.tour_ref       && <div className="text-slate-600">{row.pnlRecord.tour_ref}</div>}
                                  {row.pnlRecord.invoice_number && <div className="text-slate-400 font-mono">{row.pnlRecord.invoice_number}</div>}
                                  {row.pnlRecord.control_number && <div className="text-purple-600 font-mono">{row.pnlRecord.control_number}</div>}
                                  {!row.pnlRecord.tour_ref && !row.pnlRecord.invoice_number && !row.pnlRecord.control_number && <span className="text-slate-300">—</span>}
                                </div>
                              </td>
                              <td>
                                <div>{row.pnlRecord.vendor_name ?? '—'}</div>
                                {row.pnlRecord.agent_name && <div className="text-slate-400">{row.pnlRecord.agent_name}</div>}
                              </td>
                              <td>
                                {row.pnlRecord.pnl_date && <div>{row.pnlRecord.pnl_date}</div>}
                                {row.pnlRecord.start_date && row.pnlRecord.end_date && (
                                  <div className="text-slate-400">{row.pnlRecord.start_date} → {row.pnlRecord.end_date}</div>
                                )}
                              </td>
                              <td><PnlAmountCell record={row.pnlRecord} /></td>
                              <td>
                                {row.pnlRecord.status ? (
                                  <Badge color={pnlStatusColor(row.pnlRecord.status)}>{row.pnlRecord.status}</Badge>
                                ) : '—'}
                              </td>
                              <td>
                                <button
                                  onClick={() => router.push(`/dashboard/bookings/${row.booking.bookingRef}`)}
                                  className="font-mono font-bold text-brand-600 hover:underline flex items-center gap-1"
                                >
                                  {row.booking.bookingRef}
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                                {row.booking.isNumber && (
                                  <div className="text-blue-600 font-mono">{row.booking.isNumber}</div>
                                )}
                              </td>
                              <td>{lead}</td>
                              <td>{formatDate(row.booking.arrivalDate)}</td>
                              <td><StatusBadge status={row.booking.status as never} /></td>
                              <td><MatchBadge by={row.link.matchedBy} /></td>
                              <td className="text-slate-400">{formatDateTime(row.link.lastFetchedAt)}</td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => router.push(`/dashboard/bookings/${row.booking.bookingRef}/pnl`)}
                                    title="Open P&L page"
                                    className="p-1 text-slate-400 hover:text-brand-600 transition-colors"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => unlink(row.booking.bookingRef)}
                                    disabled={unlinking === row.booking.bookingRef}
                                    title="Remove link"
                                    className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                  >
                                    {unlinking === row.booking.bookingRef
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <Unlink className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* ── TAB: PNL Only (no booking) ── */}
            {tab === 'pnl_only' && (
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    PNL Records — No Booking Found
                    <span className="text-xs text-slate-400 font-normal">— in Accounts DB but not matched to any booking</span>
                  </h3>
                </CardHeader>
                {pnlOnly.length === 0 ? (
                  <CardBody className="py-16 text-center text-slate-400">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">All PNL records are linked to a booking</p>
                  </CardBody>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table text-xs">
                      <thead>
                        <tr>
                          <th>PNL ID</th>
                          <th>IS Number</th>
                          <th>Tour Ref / Invoice</th>
                          <th>Vendor / Agent</th>
                          <th>PNL Date</th>
                          <th>Period</th>
                          <th>Pax</th>
                          <th>Amounts</th>
                          <th>Status</th>
                          <th>Category</th>
                          <th>Country</th>
                          <th>Created</th>
                          <th>Assign Booking</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pnlOnly.map(rec => (
                          <tr key={rec.id} className="hover:bg-amber-50/30">
                            <td className="font-mono font-bold text-slate-700">#{rec.id}</td>
                            <td>
                              {rec.is_number
                                ? <span className="font-mono font-bold text-blue-700">{rec.is_number}</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                            <td>
                              <div className="space-y-0.5">
                                {rec.tour_ref       && <div className="text-slate-600">{rec.tour_ref}</div>}
                                {rec.invoice_number && <div className="font-mono text-slate-500">{rec.invoice_number}</div>}
                                {rec.control_number && <div className="text-purple-600 font-mono">{rec.control_number}</div>}
                                {!rec.tour_ref && !rec.invoice_number && !rec.control_number && <span className="text-slate-300">—</span>}
                              </div>
                            </td>
                            <td>
                              <div className="font-medium">{rec.vendor_name ?? '—'}</div>
                              {rec.agent_name && <div className="text-slate-400">{rec.agent_name}</div>}
                            </td>
                            <td>{rec.pnl_date ?? '—'}</td>
                            <td>
                              {rec.start_date && rec.end_date
                                ? <span>{rec.start_date} → {rec.end_date}</span>
                                : '—'}
                            </td>
                            <td className="text-center">{rec.total_pax ?? '—'}</td>
                            <td><PnlAmountCell record={rec} /></td>
                            <td>
                              {rec.status
                                ? <Badge color={pnlStatusColor(rec.status)}>{rec.status}</Badge>
                                : '—'}
                            </td>
                            <td>{rec.category ?? '—'}</td>
                            <td>{rec.country_code ?? '—'}</td>
                            <td className="text-slate-400">
                              {rec.created_at ? formatDateTime(rec.created_at) : '—'}
                            </td>
                            <td>
                              <button
                                onClick={() => setAssignTarget(rec)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors whitespace-nowrap"
                              >
                                <Link2 className="w-3.5 h-3.5" />
                                Assign Booking
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* ── TAB: Bookings Only (no PNL) ── */}
            {tab === 'bookings_only' && (
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-rose-500" />
                    Bookings — No PNL Match
                    <span className="text-xs text-slate-400 font-normal">— bookings in our system with no Accounts PNL linked</span>
                  </h3>
                </CardHeader>
                {bookingsOnly.length === 0 ? (
                  <CardBody className="py-16 text-center text-slate-400">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">All active bookings have a PNL link</p>
                  </CardBody>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table text-xs">
                      <thead>
                        <tr>
                          <th>Booking Ref</th>
                          <th>IS Number</th>
                          <th>Agent Booking ID</th>
                          <th>Lead Passenger</th>
                          <th>Agent</th>
                          <th>Deal</th>
                          <th>Arrival</th>
                          <th>Departure</th>
                          <th>Pax</th>
                          <th>Quoted</th>
                          <th>Country</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bookingsOnly.map(b => {
                          const lead = b.passengers[0]?.name ?? '—'
                          return (
                            <tr key={b.id} className="hover:bg-rose-50/30">
                              <td>
                                <button
                                  onClick={() => router.push(`/dashboard/bookings/${b.bookingRef}`)}
                                  className="font-mono font-bold text-brand-600 hover:underline"
                                >
                                  {b.bookingRef}
                                </button>
                              </td>
                              <td className="font-mono text-blue-700">{b.isNumber ?? '—'}</td>
                              <td className="font-mono text-purple-700">{b.agentBookingId ?? '—'}</td>
                              <td>{lead}</td>
                              <td>{b.agent ?? '—'}</td>
                              <td className="max-w-[160px] truncate">{b.dealName ?? '—'}</td>
                              <td>{formatDate(b.arrivalDate)}</td>
                              <td>{formatDate(b.departureDate)}</td>
                              <td>{b.paxAdults + b.paxChildren}</td>
                              <td>{b.quotedTotal ? formatCurrency(b.quotedTotal, b.currency) : '—'}</td>
                              <td>
                                {b.operationCountry && (
                                  <span className="font-mono text-xs">
                                    {b.operationCountry === 'VIETNAM'            ? '🇻🇳 VN'
                                    : b.operationCountry === 'SRILANKA'           ? '🇱🇰 SL'
                                    : b.operationCountry === 'SINGAPORE'          ? '🇸🇬 SG'
                                    : b.operationCountry === 'MALAYSIA'           ? '🇲🇾 MY'
                                    : b.operationCountry === 'SINGAPORE_MALAYSIA' ? '🇸🇬 SG/MY'
                                    : b.operationCountry}
                                  </span>
                                )}
                              </td>
                              <td><StatusBadge status={b.status as never} /></td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => router.push(`/dashboard/bookings/${b.bookingRef}`)}
                                    className="p-1 text-slate-400 hover:text-brand-600 transition-colors"
                                    title="Open booking"
                                  >
                                    <ArrowRight className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </div>

      {/* ── Assign booking modal ── */}
      {assignTarget && (
        <AssignBookingModal
          pnlRecord={assignTarget}
          onClose={() => setAssignTarget(null)}
          onLinked={() => {
            setAssignTarget(null)
            load(search, true)
          }}
        />
      )}
    </div>
  )
}
