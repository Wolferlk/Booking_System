'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Loader2, Download, Filter, X, Calendar, Search,
  Users, Truck, MapPin, Clock, ChevronUp, ChevronDown,
  ClipboardList, RefreshCw, Table2,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT'

type MCRow = {
  id:           string
  date:         string
  vnCode:       string
  location:     string
  paxAdults:    number
  paxChildren:  number
  fromPoint:    string | null
  toPoint:      string | null
  details:      string | null
  mealPlan:     string | null
  meetingTime:  string | null
  serviceType:  ServiceType
  vendor:       string | null
  driverName:   string | null
  vehicleType:  string | null
  vehiclePlate: string | null
  agent:        string | null
  bookingStatus: string
}

type SortField = 'date' | 'vnCode' | 'location' | 'serviceType' | 'meetingTime'
type SortDir   = 'asc' | 'desc'

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<ServiceType, string> = {
  PVT_TRANSFER:    'Private',
  SIC_TRANSFER:    'SIC',
  OWN_ARRANGEMENT: 'Own Arr.',
}

const SERVICE_COLORS: Record<ServiceType, string> = {
  PVT_TRANSFER:    'bg-emerald-100 text-emerald-700 ring-emerald-200',
  SIC_TRANSFER:    'bg-blue-100 text-blue-700 ring-blue-200',
  OWN_ARRANGEMENT: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const MEAL_COLORS: Record<string, string> = {
  BB:  'bg-amber-100 text-amber-700',
  HB:  'bg-orange-100 text-orange-700',
  FB:  'bg-rose-100 text-rose-700',
  AI:  'bg-purple-100 text-purple-700',
  RO:  'bg-slate-100 text-slate-600',
}

const SERVICE_TYPE_OPTIONS = [
  { value: '',               label: 'All Types' },
  { value: 'PVT_TRANSFER',  label: 'Private Transfer' },
  { value: 'SIC_TRANSFER',  label: 'SIC Transfer' },
  { value: 'OWN_ARRANGEMENT', label: 'Own Arrangement' },
]

// ─── Quick-range helpers ──────────────────────────────────────────────────────

function todayISO()      { return new Date().toISOString().slice(0, 10) }
function offsetISO(d: number) {
  const dt = new Date(); dt.setDate(dt.getDate() + d)
  return dt.toISOString().slice(0, 10)
}
function startOfWeek() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1)
  return d.toISOString().slice(0, 10)
}
function endOfWeek() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + 7)
  return d.toISOString().slice(0, 10)
}
function startOfMonth() {
  const d = new Date(); d.setDate(1)
  return d.toISOString().slice(0, 10)
}
function endOfMonth() {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 0)
  return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: 'Today',      from: () => todayISO(),     to: () => todayISO()     },
  { label: 'Tomorrow',   from: () => offsetISO(1),   to: () => offsetISO(1)   },
  { label: 'This Week',  from: () => startOfWeek(),  to: () => endOfWeek()    },
  { label: 'This Month', from: () => startOfMonth(), to: () => endOfMonth()   },
]

// ─── ServiceType badge ────────────────────────────────────────────────────────

function ServiceBadge({ type }: { type: ServiceType }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ring-1 whitespace-nowrap',
      SERVICE_COLORS[type] ?? 'bg-slate-100 text-slate-600 ring-slate-200',
    )}>
      {SERVICE_LABELS[type] ?? type}
    </span>
  )
}

// ─── MealPlan badge ───────────────────────────────────────────────────────────

function MealBadge({ plan }: { plan: string }) {
  const key = plan.toUpperCase()
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold',
      MEAL_COLORS[key] ?? 'bg-slate-100 text-slate-600',
    )}>
      {plan}
    </span>
  )
}

// ─── Sortable header ──────────────────────────────────────────────────────────

function SortTh({
  field, label, sort, onSort,
}: {
  field: SortField
  label: string
  sort: { field: SortField; dir: SortDir }
  onSort: (f: SortField) => void
}) {
  const active = sort.field === field
  return (
    <th
      onClick={() => onSort(field)}
      className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap cursor-pointer hover:text-slate-800 select-none group"
    >
      <span className="flex items-center gap-1">
        {label}
        <span className={cn('transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-50')}>
          {active && sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </span>
    </th>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MCReportPage() {
  const [rows, setRows]           = useState<MCRow[]>([])
  const [loading, setLoading]     = useState(false)
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [search, setSearch]       = useState('')
  const [svcFilter, setSvcFilter] = useState('')
  const [activeRange, setActiveRange] = useState<string | null>(null)
  const [sort, setSort]           = useState<{ field: SortField; dir: SortDir }>({ field: 'date', dir: 'asc' })
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom)    params.set('dateFrom', dateFrom)
      if (dateTo)      params.set('dateTo',   dateTo)
      if (search)      params.set('search',   search)
      if (svcFilter)   params.set('serviceType', svcFilter)

      const res  = await fetch(`/api/mc-report?${params}`)
      const json = await res.json()
      if (json.success) {
        setRows(json.data)
      } else {
        toast.error(json.error ?? 'Failed to load MC Report')
      }
    } catch {
      toast.error('Failed to load MC Report')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, search, svcFilter])

  useEffect(() => {
    // Auto-load with today's date on mount
    const today = todayISO()
    setDateFrom(today)
    setDateTo(today)
    setActiveRange('Today')
  }, [])

  // Re-fetch when dates change from quick-range selection
  useEffect(() => {
    if (dateFrom && dateTo) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, svcFilter])

  // ── Quick range selection ────────────────────────────────────────────────────

  function applyRange(r: typeof QUICK_RANGES[number]) {
    setDateFrom(r.from())
    setDateTo(r.to())
    setActiveRange(r.label)
  }

  function clearFilters() {
    setDateFrom(''); setDateTo(''); setSearch(''); setSvcFilter(''); setActiveRange(null)
  }

  // ── Sort ─────────────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    setSort(s => ({
      field,
      dir: s.field === field && s.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    switch (sort.field) {
      case 'date':        return dir * a.date.localeCompare(b.date)
      case 'vnCode':      return dir * a.vnCode.localeCompare(b.vnCode)
      case 'location':    return dir * a.location.localeCompare(b.location)
      case 'serviceType': return dir * a.serviceType.localeCompare(b.serviceType)
      case 'meetingTime': return dir * (a.meetingTime ?? '').localeCompare(b.meetingTime ?? '')
      default:            return 0
    }
  })

  // ── Stats ─────────────────────────────────────────────────────────────────────

  const totalAdults   = rows.reduce((s, r) => s + r.paxAdults, 0)
  const totalChildren = rows.reduce((s, r) => s + r.paxChildren, 0)
  const pvtCount      = rows.filter(r => r.serviceType === 'PVT_TRANSFER').length
  const sicCount      = rows.filter(r => r.serviceType === 'SIC_TRANSFER').length
  const ownCount      = rows.filter(r => r.serviceType === 'OWN_ARRANGEMENT').length

  // ── CSV Export ────────────────────────────────────────────────────────────────

  function downloadCSV() {
    if (rows.length === 0) { toast.error('No data to export'); return }

    const headers = [
      'Date', 'VN Code', 'Location', 'Adults', 'Children',
      'From', 'To', 'Details', 'Meal Plan', 'Meeting Time',
      'Service Type', 'Vendor', 'Driver', 'Vehicle Type', 'Plate',
    ]

    const csvRows = sorted.map(r => [
      r.date,
      r.vnCode,
      r.location,
      r.paxAdults,
      r.paxChildren,
      r.fromPoint  ?? '',
      r.toPoint    ?? '',
      r.details    ?? '',
      r.mealPlan   ?? '',
      r.meetingTime ?? '',
      SERVICE_LABELS[r.serviceType] ?? r.serviceType,
      r.vendor     ?? '',
      r.driverName ?? '',
      r.vehicleType ?? '',
      r.vehiclePlate ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

    const csv  = [headers.join(','), ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `mc-report-${dateFrom || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${sorted.length} rows`)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <Header
        title="MC Report"
        subtitle="Movement & Coordination — one row per agenda item"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              Refresh
            </button>
            <button onClick={downloadCSV} className="btn btn-primary btn-sm">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-5">

        {/* ── Filter Panel ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" /> Filters
            </h3>
          </CardHeader>
          <CardBody>
            {/* Quick date ranges */}
            <div className="flex flex-wrap gap-2 mb-4">
              {QUICK_RANGES.map(r => (
                <button
                  key={r.label}
                  onClick={() => applyRange(r)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    activeRange === r.label
                      ? 'bg-brand-500 text-white border-brand-500 shadow-sm shadow-brand-500/30'
                      : 'border-slate-200 text-slate-600 hover:border-brand-400 hover:text-brand-600',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Input filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Date From
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setActiveRange(null) }}
                />
              </div>
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Date To
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setActiveRange(null) }}
                />
              </div>
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-400" /> VN Code / Agent
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. AH-2025-001"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && load()}
                />
              </div>
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-slate-400" /> Service Type
                </label>
                <select
                  className="form-select"
                  value={svcFilter}
                  onChange={e => setSvcFilter(e.target.value)}
                >
                  {SERVICE_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button onClick={load} disabled={loading} className="btn btn-primary btn-sm">
                {loading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Filter className="w-4 h-4" />}
                Apply
              </button>
              <button onClick={clearFilters} className="btn btn-secondary btn-sm">
                <X className="w-4 h-4" /> Clear
              </button>
              {rows.length > 0 && (
                <span className="ml-auto text-xs text-slate-400">
                  {rows.length} movement{rows.length !== 1 ? 's' : ''} found
                </span>
              )}
            </div>
          </CardBody>
        </Card>

        {/* ── Stats Bar ─────────────────────────────────────────────────── */}
        {rows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              {
                icon: <Table2 className="w-4 h-4" />,
                label: 'Movements',
                value: rows.length,
                color: 'text-slate-900',
                bg:    'bg-slate-50',
              },
              {
                icon: <Users className="w-4 h-4" />,
                label: 'Adults',
                value: totalAdults,
                color: 'text-blue-700',
                bg:    'bg-blue-50',
              },
              {
                icon: <Users className="w-4 h-4" />,
                label: 'Children',
                value: totalChildren,
                color: 'text-violet-700',
                bg:    'bg-violet-50',
              },
              {
                icon: <Truck className="w-4 h-4" />,
                label: 'Private',
                value: pvtCount,
                color: 'text-emerald-700',
                bg:    'bg-emerald-50',
              },
              {
                icon: <Truck className="w-4 h-4" />,
                label: `SIC / Own`,
                value: `${sicCount} / ${ownCount}`,
                color: 'text-amber-700',
                bg:    'bg-amber-50',
              },
            ].map(stat => (
              <div key={stat.label} className={cn('rounded-xl p-4 border border-slate-200 flex items-center gap-3 shadow-sm', stat.bg)}>
                <div className={cn('flex-shrink-0', stat.color)}>{stat.icon}</div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">{stat.label}</div>
                  <div className={cn('text-lg font-bold leading-tight', stat.color)}>{stat.value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            action={
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <ClipboardList className="w-3.5 h-3.5" />
                {loading ? 'Loading…' : `${sorted.length} row${sorted.length !== 1 ? 's' : ''}`}
              </div>
            }
          >
            <h3 className="text-sm font-semibold text-slate-900">Movement Items</h3>
          </CardHeader>
          <CardBody className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-7 h-7 text-brand-500 animate-spin" />
                <p className="text-sm text-slate-400">Loading movement data…</p>
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <MapPin className="w-8 h-8 opacity-30" />
                <p className="text-sm font-medium">No movement items found</p>
                <p className="text-xs">Try adjusting the date range or clearing filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[1200px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 sticky top-0">
                      <SortTh field="date"        label="Date"         sort={sort} onSort={handleSort} />
                      <SortTh field="vnCode"      label="VN Code"      sort={sort} onSort={handleSort} />
                      <SortTh field="location"    label="Location"     sort={sort} onSort={handleSort} />
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Adults</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Child</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">From</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">To</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Details</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Meal</th>
                      <SortTh field="meetingTime" label="Meet Time"    sort={sort} onSort={handleSort} />
                      <SortTh field="serviceType" label="Service"      sort={sort} onSort={handleSort} />
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Vendor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sorted.map(row => {
                      const isExpanded = expandedRow === row.id
                      return (
                        <>
                          <tr
                            key={row.id}
                            onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                            className={cn(
                              'transition-colors cursor-pointer group',
                              isExpanded
                                ? 'bg-brand-50/60 border-l-2 border-l-brand-400'
                                : 'hover:bg-slate-50/80',
                            )}
                          >
                            {/* Date */}
                            <td className="px-3 py-2.5 whitespace-nowrap font-medium text-slate-800">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                {formatDate(row.date)}
                              </div>
                            </td>

                            {/* VN Code */}
                            <td className="px-3 py-2.5">
                              <a
                                href={`/dashboard/bookings/${row.vnCode}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="font-mono font-semibold text-brand-700 hover:underline whitespace-nowrap"
                              >
                                {row.vnCode}
                              </a>
                            </td>

                            {/* Location */}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                <span className="text-slate-700 font-medium">{row.location}</span>
                              </div>
                            </td>

                            {/* Adults / Children */}
                            <td className="px-3 py-2.5 text-center">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-[11px]">
                                {row.paxAdults}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={cn(
                                'inline-flex items-center justify-center w-6 h-6 rounded-full font-bold text-[11px]',
                                row.paxChildren > 0
                                  ? 'bg-violet-100 text-violet-700'
                                  : 'bg-slate-100 text-slate-400',
                              )}>
                                {row.paxChildren}
                              </span>
                            </td>

                            {/* From */}
                            <td className="px-3 py-2.5 text-slate-600 max-w-[120px]">
                              <span className="block truncate" title={row.fromPoint ?? ''}>
                                {row.fromPoint ?? <span className="text-slate-300">—</span>}
                              </span>
                            </td>

                            {/* To */}
                            <td className="px-3 py-2.5 text-slate-600 max-w-[120px]">
                              <span className="block truncate" title={row.toPoint ?? ''}>
                                {row.toPoint ?? <span className="text-slate-300">—</span>}
                              </span>
                            </td>

                            {/* Details */}
                            <td className="px-3 py-2.5 text-slate-500 max-w-[160px]">
                              <span className="block truncate" title={row.details ?? ''}>
                                {row.details
                                  ? row.details.length > 45
                                    ? row.details.slice(0, 45) + '…'
                                    : row.details
                                  : <span className="text-slate-300">—</span>}
                              </span>
                            </td>

                            {/* Meal Plan */}
                            <td className="px-3 py-2.5">
                              {row.mealPlan
                                ? <MealBadge plan={row.mealPlan} />
                                : <span className="text-slate-300 text-[10px]">—</span>}
                            </td>

                            {/* Meeting Time */}
                            <td className="px-3 py-2.5">
                              {row.meetingTime
                                ? (
                                  <div className="flex items-center gap-1 whitespace-nowrap text-slate-700 font-medium">
                                    <Clock className="w-3 h-3 text-slate-400" />
                                    {row.meetingTime}
                                  </div>
                                )
                                : <span className="text-slate-300 text-[10px]">—</span>}
                            </td>

                            {/* Service Type */}
                            <td className="px-3 py-2.5">
                              <ServiceBadge type={row.serviceType} />
                            </td>

                            {/* Vendor */}
                            <td className="px-3 py-2.5 text-slate-600 max-w-[140px]">
                              {row.vendor
                                ? (
                                  <div className="flex items-center gap-1.5">
                                    <Truck className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                    <span className="truncate" title={row.vendor}>{row.vendor}</span>
                                  </div>
                                )
                                : <span className="text-slate-300 text-[10px]">—</span>}
                            </td>
                          </tr>

                          {/* Expanded detail row */}
                          {isExpanded && (
                            <tr key={`${row.id}-detail`} className="bg-brand-50/40 border-l-2 border-l-brand-400">
                              <td colSpan={12} className="px-4 py-3">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                                  {[
                                    { label: 'Full Details',   value: row.details },
                                    { label: 'Driver',         value: row.driverName },
                                    { label: 'Vehicle Type',   value: row.vehicleType },
                                    { label: 'Vehicle Plate',  value: row.vehiclePlate },
                                    { label: 'Agent',          value: row.agent },
                                    { label: 'Booking Status', value: row.bookingStatus?.replace(/_/g, ' ') },
                                    { label: 'Pax',            value: `${row.paxAdults} Adults, ${row.paxChildren} Children` },
                                    { label: 'Vendor',         value: row.vendor },
                                  ].map(item => (
                                    item.value ? (
                                      <div key={item.label}>
                                        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">{item.label}</p>
                                        <p className="text-slate-700 font-medium">{item.value}</p>
                                      </div>
                                    ) : null
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

      </div>
    </div>
  )
}
