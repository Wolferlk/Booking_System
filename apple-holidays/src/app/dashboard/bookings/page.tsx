'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Plus, Search, FileText, Loader2, ArrowRight, Users, Calendar,
  ArrowUp, ArrowDown, ArrowUpDown, Clock, CheckCircle2, XCircle,
  Hash, MapPin, TrendingUp,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils'
import { STATUS_LABELS } from '@/lib/state-machine'
import { useSession } from 'next-auth/react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import type { BookingStatus } from '@prisma/client'

const STATUSES = Object.keys(STATUS_LABELS) as BookingStatus[]

type SortField = 'arrivalDate' | 'departureDate' | 'createdAt' | 'updatedAt'
type SortDir   = 'asc' | 'desc'
type DateFilter = '' | 'today' | 'this_week' | 'this_month'

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: '',           label: 'All' },
  { value: 'today',      label: 'Today' },
  { value: 'this_week',  label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
]

const SORT_FIELD_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'arrivalDate',   label: 'Arrival Date' },
  { value: 'departureDate', label: 'Departure Date' },
  { value: 'createdAt',     label: 'Created' },
  { value: 'updatedAt',     label: 'Last Updated' },
]

interface Booking {
  id: string
  bookingRef: string
  agent: string | null
  agentBookingId: string | null
  fileHandler: string | null
  status: BookingStatus
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: string
  currency: string
  createdAt: string
  isNumber: string | null
  passengers: { name: string; isLead: boolean }[]
  createdBy: { name: string; role: string }
  _count: { changeRequests: number }
  pnl: { id: string } | null
  tourAgenda: { id: string } | null
  operationCountry: string | null
}

const COUNTRY_BADGE: Record<string, { flag: string; label: string; color: string }> = {
  VIETNAM:            { flag: '🇻🇳', label: 'Vietnam',   color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  SRILANKA:           { flag: '🇱🇰', label: 'Sri Lanka', color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
  SINGAPORE:          { flag: '🇸🇬', label: 'Singapore', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  MALAYSIA:           { flag: '🇲🇾', label: 'Malaysia',  color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  SINGAPORE_MALAYSIA: { flag: '🇸🇬', label: 'SG & MY',   color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  ALL:                { flag: '🌐', label: 'All',        color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
}

function SortIcon({ field, sortBy, sortDir }: { field: SortField; sortBy: SortField; sortDir: SortDir }) {
  if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-25 inline" />
  return sortDir === 'asc'
    ? <ArrowUp   className="w-3 h-3 ml-1 text-brand-600 inline" />
    : <ArrowDown className="w-3 h-3 ml-1 text-brand-600 inline" />
}

function BookingsPageInner() {
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { countryFilter } = useCountryFilter()

  const [bookings, setBookings]       = useState<Booking[]>([])
  const [total, setTotal]             = useState(0)
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState(searchParams.get('search') ?? '')
  const [refSearch, setRefSearch]     = useState('')          // IS / VN / agent ID search
  const [status, setStatus]           = useState(searchParams.get('status') ?? '')
  const [dateFilter, setDateFilter]   = useState<DateFilter>((searchParams.get('dateFilter') ?? '') as DateFilter)
  const [dateFrom, setDateFrom]       = useState('')          // created-at range
  const [dateTo, setDateTo]           = useState('')
  const [sortBy, setSortBy]           = useState<SortField>((searchParams.get('sortBy') ?? 'createdAt') as SortField)
  const [sortDir, setSortDir]         = useState<SortDir>((searchParams.get('sortDir') ?? 'desc') as SortDir)

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search)                                         params.set('search',     search)
    if (refSearch)                                      params.set('refSearch',  refSearch)
    if (status)                                         params.set('status',     status)
    if (dateFilter)                                     params.set('dateFilter', dateFilter)
    if (dateFrom)                                       params.set('dateFrom',   dateFrom)
    if (dateTo)                                         params.set('dateTo',     dateTo)
    if (countryFilter && countryFilter !== 'ALL')       params.set('country',    countryFilter)
    params.set('sortBy',  sortBy)
    params.set('sortDir', sortDir)
    try {
      const res  = await fetch(`/api/bookings?${params}`)
      const json = await res.json()
      if (json.success) {
        setBookings(json.data.bookings)
        setTotal(json.data.total)
      }
    } finally {
      setLoading(false)
    }
  }, [search, refSearch, status, dateFilter, dateFrom, dateTo, sortBy, sortDir, countryFilter])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  function clearDateRange() {
    setDateFrom('')
    setDateTo('')
  }

  const role      = session?.user?.role
  const canCreate = ['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role ?? '')

  return (
    <div>
      <Header
        title="All Bookings"
        subtitle={`${total} total booking${total !== 1 ? 's' : ''}`}
        actions={
          canCreate ? (
            <Button onClick={() => router.push('/dashboard/bookings/new')} icon={<Plus className="w-4 h-4" />}>
              New Booking
            </Button>
          ) : undefined
        }
      />

      <div className="p-8 space-y-5">
        {/* ── Filters ──────────────────────────────────────────────────── */}
        <Card className="p-4 space-y-3">

          {/* Row 1 — Passenger / agent name search + Status */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by ref, agent, passenger name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="form-input pl-9"
              />
            </div>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="form-select w-full sm:w-52"
            >
              <option value="">All statuses</option>
              {STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* Row 2 — IS / VN / Tour ref / Agent ID search + Created date range */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Filter by IS number, VN number, Tour ref, Agent ID…"
                value={refSearch}
                onChange={e => setRefSearch(e.target.value)}
                className="form-input pl-9"
              />
            </div>

            {/* Created date range */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-slate-400 whitespace-nowrap">Created</span>
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setDateFilter('') }}
                className="form-input text-sm py-1.5 w-36"
              />
              <span className="text-xs text-slate-400">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setDateFilter('') }}
                className="form-input text-sm py-1.5 w-36"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={clearDateRange}
                  className="text-xs text-slate-400 hover:text-slate-600 px-1.5"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Row 3 — Date period pills + Sort controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-0.5" />
              {DATE_FILTER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setDateFilter(opt.value); if (opt.value) clearDateRange() }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                    dateFilter === opt.value && !dateFrom && !dateTo
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="sm:ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-400 whitespace-nowrap">Sort by</span>
              <select
                value={sortBy}
                onChange={e => { setSortBy(e.target.value as SortField); setSortDir('desc') }}
                className="form-select text-sm py-1.5 pr-8"
              >
                {SORT_FIELD_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium transition-colors"
              >
                {sortDir === 'asc'
                  ? <><ArrowUp   className="w-3.5 h-3.5" /> Asc</>
                  : <><ArrowDown className="w-3.5 h-3.5" /> Desc</>
                }
              </button>
            </div>
          </div>
        </Card>

        {/* ── Table ──────────────────────────────────────────────────── */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
            </div>
          ) : bookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No bookings found</p>
              {canCreate && (
                <Link href="/dashboard/bookings/new" className="mt-3 text-sm text-brand-600 hover:underline">
                  Create your first booking
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Booking / Numbers</th>
                    <th>Country</th>
                    <th>Lead Passenger</th>
                    <th>Agent</th>
                    <th>
                      <button className="flex items-center whitespace-nowrap hover:text-brand-700 transition-colors" onClick={() => toggleSort('arrivalDate')}>
                        Arrival <SortIcon field="arrivalDate" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </th>
                    <th>
                      <button className="flex items-center whitespace-nowrap hover:text-brand-700 transition-colors" onClick={() => toggleSort('departureDate')}>
                        Departure <SortIcon field="departureDate" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </th>
                    <th>Pax</th>
                    <th>Quoted</th>
                    <th>Status</th>

                    <th>
                      <button className="flex items-center whitespace-nowrap hover:text-brand-700 transition-colors" onClick={() => toggleSort('createdAt')}>
                        Created <SortIcon field="createdAt" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </th>
                    <th>PNL</th>
                    <th>Agenda</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bookings.map(b => {
                    const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
                    return (
                      <tr
                        key={b.id}
                        className="cursor-pointer hover:bg-slate-50 transition-colors"
                        onClick={() => router.push(`/dashboard/bookings/${b.bookingRef}`)}
                      >
                        {/* Booking ref + all numbers */}
                        <td onClick={e => e.stopPropagation()}>
                          <Link href={`/dashboard/bookings/${b.bookingRef}`} className="font-semibold text-slate-900 font-mono hover:text-brand-600">
                            {b.bookingRef}
                          </Link>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {b.isNumber && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-600 border border-blue-100">
                                IS: {b.isNumber}
                              </span>
                            )}
                            {b.agentBookingId && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-50 text-purple-600 border border-purple-100">
                                ID: {b.agentBookingId}
                              </span>
                            )}
                            {b._count.changeRequests > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">
                                {b._count.changeRequests} change{b._count.changeRequests > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Country */}
                        <td>
                          {b.operationCountry && COUNTRY_BADGE[b.operationCountry] ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-none text-[11px] font-medium border ${COUNTRY_BADGE[b.operationCountry].color}`}>
                              {COUNTRY_BADGE[b.operationCountry].flag} {COUNTRY_BADGE[b.operationCountry].label}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>

                        {/* Lead passenger */}
                        <td>{lead?.name ?? '—'}</td>

                        {/* Agent */}
                        <td className="text-slate-500 text-xs">{b.agent ?? '—'}</td>

                        {/* Arrival */}
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <Calendar className="w-3 h-3 flex-shrink-0" />
                            {formatDate(b.arrivalDate)}
                          </div>
                        </td>

                        {/* Departure */}
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <Calendar className="w-3 h-3 flex-shrink-0" />
                            {formatDate(b.departureDate)}
                          </div>
                        </td>

                        {/* Pax */}
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <Users className="w-3 h-3" />
                            {b.paxAdults + b.paxChildren}
                          </div>
                        </td>

                        {/* Quoted */}
                        <td className="font-semibold text-slate-800">
                          {formatCurrency(b.quotedTotal, b.currency)}
                        </td>

                        {/* Status */}
                        <td><StatusBadge className="rounded-none" status={b.status} /></td>

                        {/* Created */}
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            {formatDateTime(b.createdAt)}
                          </div>
                        </td>

                        {/* PNL — clickable if merged */}
                        <td onClick={e => e.stopPropagation()}>
                          {b.pnl ? (
                            <Link
                              href={`/dashboard/bookings/${b.bookingRef}/pnl`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 hover:bg-emerald-100 transition-colors"
                            >
                              <TrendingUp className="w-3 h-3" /> PNL
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                              <XCircle className="w-3 h-3" /> No PNL
                            </span>
                          )}
                        </td>

                        {/* Agenda — only if agenda exists */}
                        <td onClick={e => e.stopPropagation()}>
                          {b.tourAgenda ? (
                            <Link
                              href={`/dashboard/bookings/${b.bookingRef}/agenda`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 hover:bg-blue-100 transition-colors"
                            >
                              <MapPin className="w-3 h-3" /> Agenda
                            </Link>
                          ) : (
                            <Link
                              href={`/dashboard/bookings/${b.bookingRef}/agenda`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200 hover:bg-slate-100 transition-colors"
                            >
                              <MapPin className="w-3 h-3" /> View
                            </Link>
                          )}
                        </td>

                        <td>
                          <ArrowRight className="w-4 h-4 text-slate-300" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export default function BookingsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mt-20" /></div>}>
      <BookingsPageInner />
    </Suspense>
  )
}
