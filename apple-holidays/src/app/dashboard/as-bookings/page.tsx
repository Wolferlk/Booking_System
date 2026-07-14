'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Loader2, Cloud, CheckCircle2, Clock, Layers, RefreshCw,
  Calendar, Users, ArrowRight, MapPin, Hash, X, AlertCircle, LayoutGrid, List,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'

type StatusFilter = '2' | '1' | 'all'
type ViewMode = 'grid' | 'table'
type DateFilter = 'today' | 'this_week' | 'this_month' | 'custom'

interface ASBooking {
  id: number
  quotation_no: string
  reference_id: string
  reference_id_full?: string[]
  status: string
  status_class: string
  country: string | null
  country_name: string | null
  currency: string | null
  tour_type: string | null
  created_at?: { date: string } | string | null
  main?: { arrival_year?: string; arrival_month?: string; arrival_day?: string }
  pax?: { adult?: string; cwb?: string; cnb?: string; total_children?: number }
  quotation_update_count_C?: number
  quotation_update_count_R?: number
  map_image_url?: string
}

const STATUS_TABS: { value: StatusFilter; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: '2',   label: 'Confirmed',   icon: CheckCircle2 },
  { value: '1',   label: 'Unconfirmed', icon: Clock },
  { value: 'all', label: 'All',         icon: Layers },
]

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'today',      label: 'Today' },
  { value: 'this_week',  label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
]

const COUNTRY_STYLE: Record<string, string> = {
  Vietnam:    'bg-red-500/10 text-red-600 border-red-500/20',
  'Sri Lanka':'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  Singapore:  'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Malaysia:   'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
}

function countryStyle(name: string | null): string {
  return (name && COUNTRY_STYLE[name]) || 'bg-slate-500/10 text-slate-500 border-slate-500/20'
}

function isConfirmed(b: ASBooking) {
  return b.status === '2' || b.status_class === 'confirm'
}

function arrivalDate(b: ASBooking): string {
  const m = b.main
  if (!m?.arrival_year || !m?.arrival_month || !m?.arrival_day) return '—'
  const d = new Date(Number(m.arrival_year), Number(m.arrival_month) - 1, Number(m.arrival_day))
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function paxTotal(b: ASBooking): number {
  const p = b.pax
  if (!p) return 0
  return Number(p.adult ?? 0) + Number(p.cwb ?? 0) + Number(p.cnb ?? 0)
}

function cntlNumber(b: ASBooking): string | null {
  return b.reference_id_full?.find((r) => /CNTL/i.test(r)) ?? null
}

const fmtDate = (d: Date) => {
  // Local-date ISO (avoid UTC shift from toISOString)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Arrival-date window for a named period filter. */
function rangeForFilter(filter: DateFilter): { from: string; to: string } {
  const now = new Date()
  if (filter === 'today') {
    return { from: fmtDate(now), to: fmtDate(now) }
  }
  if (filter === 'this_week') {
    const day = now.getDay() // 0 = Sun
    const diffToMon = (day + 6) % 7
    const mon = new Date(now); mon.setDate(now.getDate() - diffToMon)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { from: fmtDate(mon), to: fmtDate(sun) }
  }
  // this_month
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: fmtDate(first), to: fmtDate(last) }
}

function ASBookingsInner() {
  const router = useRouter()
  const [bookings, setBookings] = useState<ASBooking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState<StatusFilter>('2')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [country, setCountry] = useState<string>('ALL')
  const [view, setView] = useState<ViewMode>('grid')

  const [dateFilter, setDateFilter] = useState<DateFilter>('today')
  const initialRange = useMemo(() => rangeForFilter('today'), [])
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)

  // Apply a named period → sets the arrival window
  const applyDateFilter = useCallback((f: DateFilter) => {
    setDateFilter(f)
    if (f !== 'custom') {
      const r = rangeForFilter(f)
      setFrom(r.from)
      setTo(r.to)
    }
  }, [])

  // Debounce the search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('status', status)
      params.set('from', from)
      params.set('to', to)
      if (debouncedSearch) params.set('search', debouncedSearch)
      const res = await fetch(`/api/as-bookings?${params.toString()}`)
      const json = await res.json()
      if (!json.success) {
        setError(json.error ?? 'Failed to load bookings')
        setBookings([])
        setTotal(0)
        return
      }
      setBookings(json.data.bookings)
      setTotal(json.data.total)
    } catch {
      setError('Network error — could not reach AppleSystem')
      setBookings([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [status, from, to, debouncedSearch])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  // Country filter is applied client-side over the returned set.
  const countries = useMemo(() => {
    const set = new Set<string>()
    bookings.forEach((b) => { if (b.country_name) set.add(b.country_name) })
    return Array.from(set).sort()
  }, [bookings])

  const visible = useMemo(
    () => (country === 'ALL' ? bookings : bookings.filter((b) => b.country_name === country)),
    [bookings, country],
  )

  const confirmedCount = useMemo(() => visible.filter(isConfirmed).length, [visible])
  const pendingCount = visible.length - confirmedCount

  function openDetail(b: ASBooking) {
    // Pass the rich list context so the detail page can render everything the
    // P&L endpoint doesn't return (pax breakdown, arrival, status, map, …).
    const q = new URLSearchParams({ quotation_no: b.quotation_no })
    if (b.currency) q.set('currency', 'USD')
    if (b.status) q.set('status', b.status)
    if (b.country) q.set('country', b.country)
    if (b.country_name) q.set('country_name', b.country_name)
    if (b.tour_type) q.set('tour_type', b.tour_type)
    if (b.map_image_url) q.set('map', b.map_image_url)
    const cntl = cntlNumber(b)
    if (cntl) q.set('cntl', cntl)
    if (b.reference_id_full?.length) q.set('refs', b.reference_id_full.join(','))
    const m = b.main
    if (m?.arrival_year && m?.arrival_month && m?.arrival_day) {
      q.set('arrival', `${m.arrival_year}-${String(m.arrival_month).padStart(2, '0')}-${String(m.arrival_day).padStart(2, '0')}`)
    }
    if (b.pax) {
      q.set('adult', String(b.pax.adult ?? 0))
      q.set('cwb', String(b.pax.cwb ?? 0))
      q.set('cnb', String(b.pax.cnb ?? 0))
    }
    if (b.quotation_update_count_R != null) q.set('revR', String(b.quotation_update_count_R))
    if (b.quotation_update_count_C != null) q.set('revC', String(b.quotation_update_count_C))
    router.push(`/dashboard/as-bookings/${encodeURIComponent(b.reference_id)}?${q.toString()}`)
  }

  return (
    <div>
      <Header
        title={
          <span className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-brand-500" />
            AS Bookings
          </span>
        }
        subtitle="Live travel confirmations from AppleSystem"
        actions={
          <button
            onClick={fetchBookings}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <div className="p-4 sm:p-8 space-y-5">
        {/* ── Stat tiles ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Showing" value={visible.length} icon={<Layers className="w-4 h-4" />} tone="slate" />
          <StatTile label="Confirmed" value={confirmedCount} icon={<CheckCircle2 className="w-4 h-4" />} tone="emerald" />
          <StatTile label="Unconfirmed" value={pendingCount} icon={<Clock className="w-4 h-4" />} tone="amber" />
          <StatTile label="Total in window" value={total} icon={<Cloud className="w-4 h-4" />} tone="brand" />
        </div>

        {/* ── Filters ────────────────────────────────────────────────── */}
        <Card className="p-4 space-y-4">
          {/* Status segmented control + view toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {STATUS_TABS.map((tab) => {
                const Icon = tab.icon
                const active = status === tab.value
                return (
                  <button
                    key={tab.value}
                    onClick={() => setStatus(tab.value)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      active ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                onClick={() => setView('grid')}
                className={`p-2 transition-colors ${view === 'grid' ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:bg-slate-50'}`}
                title="Card view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView('table')}
                className={`p-2 transition-colors border-l border-slate-200 ${view === 'table' ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:bg-slate-50'}`}
                title="Table view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search + date range */}
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by IS / CNTL / reference / quotation number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input pl-9 pr-9"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-slate-400 whitespace-nowrap">Arrival</span>
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setDateFilter('custom') }} className="form-input text-sm py-1.5 w-40" />
              <span className="text-xs text-slate-400">→</span>
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setDateFilter('custom') }} className="form-input text-sm py-1.5 w-40" />
            </div>
          </div>

          {/* Quick period pills — default is Today */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-0.5" />
            {DATE_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => applyDateFilter(opt.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  dateFilter === opt.value
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
            {dateFilter === 'custom' && (
              <span className="px-3 py-1 rounded-full text-xs font-medium border bg-brand-600 text-white border-brand-600">
                Custom
              </span>
            )}
          </div>

          {/* Country pills (derived from result set) */}
          {countries.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-0.5" />
              <CountryPill label="All" active={country === 'ALL'} onClick={() => setCountry('ALL')} />
              {countries.map((c) => (
                <CountryPill key={c} label={c} active={country === c} onClick={() => setCountry(c)} />
              ))}
            </div>
          )}
        </Card>

        {/* ── Results ────────────────────────────────────────────────── */}
        {loading ? (
          <Card className="flex items-center justify-center h-56">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-7 h-7 text-brand-500 animate-spin" />
              <p className="text-sm">Fetching from AppleSystem…</p>
            </div>
          </Card>
        ) : error ? (
          <Card className="flex flex-col items-center justify-center h-56 text-center px-6">
            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-sm font-semibold text-slate-700">Couldn&apos;t load bookings</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">{error}</p>
            <button
              onClick={fetchBookings}
              className="mt-4 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </Card>
        ) : visible.length === 0 ? (
          <Card className="flex flex-col items-center justify-center h-56 text-slate-400">
            <Cloud className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No bookings match your filters</p>
            <p className="text-xs mt-1">Try widening the arrival window or switching status.</p>
          </Card>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map((b) => (
              <BookingCard key={b.id} booking={b} onOpen={() => openDetail(b)} />
            ))}
          </div>
        ) : (
          <BookingTable bookings={visible} onOpen={openDetail} />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatTile({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'slate' | 'emerald' | 'amber' | 'brand' }) {
  const tones: Record<string, string> = {
    slate:   'text-slate-500 bg-slate-100',
    emerald: 'text-emerald-600 bg-emerald-50',
    amber:   'text-amber-600 bg-amber-50',
    brand:   'text-brand-600 bg-brand-50',
  }
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tones[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-900 leading-none tabular-nums">{value}</p>
        <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-wide truncate">{label}</p>
      </div>
    </Card>
  )
}

function CountryPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
        active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  )
}

function StatusChip({ booking }: { booking: ASBooking }) {
  const confirmed = isConfirmed(booking)
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
        confirmed
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}
    >
      {confirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {confirmed ? 'Confirmed' : 'Unconfirmed'}
    </span>
  )
}

function BookingCard({ booking, onOpen }: { booking: ASBooking; onOpen: () => void }) {
  const cntl = cntlNumber(booking)
  return (
    <button
      onClick={onOpen}
      className="group text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-brand-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="font-mono font-bold text-slate-900 text-lg leading-none">{booking.quotation_no}</p>
          <p className="text-[11px] text-slate-400 mt-1">ref {booking.reference_id}</p>
        </div>
        <StatusChip booking={booking} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {booking.country_name && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${countryStyle(booking.country_name)}`}>
            <MapPin className="w-3 h-3" /> {booking.country_name}
          </span>
        )}
        {cntl && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-purple-50 text-purple-600 border border-purple-100">
            <Hash className="w-3 h-3" /> {cntl}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs text-slate-600 border-t border-slate-100 pt-3">
        <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-slate-400" /> {arrivalDate(booking)}</span>
        <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-slate-400" /> {paxTotal(booking)} pax</span>
      </div>

      <div className="mt-4">
        <span className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-100 group-hover:bg-brand-600 group-hover:text-white group-hover:border-brand-600 transition-colors">
          View Booking Details <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </button>
  )
}

function BookingTable({ bookings, onOpen }: { bookings: ASBooking[]; onOpen: (b: ASBooking) => void }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Quotation / Ref</th>
              <th>CNTL</th>
              <th>Country</th>
              <th>Arrival</th>
              <th>Pax</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => onOpen(b)}>
                <td>
                  <span className="font-mono font-semibold text-slate-900">{b.quotation_no}</span>
                  <span className="block text-[11px] text-slate-400">ref {b.reference_id}</span>
                </td>
                <td className="font-mono text-xs text-slate-500">{cntlNumber(b) ?? '—'}</td>
                <td>
                  {b.country_name ? (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${countryStyle(b.country_name)}`}>
                      {b.country_name}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="text-xs text-slate-600 whitespace-nowrap">{arrivalDate(b)}</td>
                <td className="text-xs text-slate-600">{paxTotal(b)}</td>
                <td><StatusChip booking={b} /></td>
                <td onClick={(e) => { e.stopPropagation(); onOpen(b) }}>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-100 hover:bg-brand-600 hover:text-white hover:border-brand-600 transition-colors whitespace-nowrap">
                    View Details <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default function ASBookingsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mt-20" /></div>}>
      <ASBookingsInner />
    </Suspense>
  )
}
