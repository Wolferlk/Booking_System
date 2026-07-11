'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  Loader2, Download, Filter, X, Calendar, Search,
  Users, Truck, MapPin, Clock, ChevronUp, ChevronDown,
  ClipboardList, RefreshCw, Table2, Globe, FileText,
  FileSpreadsheet, Printer, ChevronDown as ChevronDownIcon,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'
import DriverVendorModal from '@/components/shared/driver-vendor-modal'

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT'

type MCRow = {
  id:             string
  date:           string
  vnCode:         string
  isNumber:       string | null
  agentBookingId: string | null
  location:       string
  paxAdults:      number
  paxChildren:    number
  fromPoint:      string | null
  toPoint:        string | null
  details:        string | null
  mealPlan:       string | null
  meetingTime:    string | null
  serviceType:    ServiceType
  vendor:         string | null
  driverId:       string | null
  vendorId:       string | null
  driverName:     string | null
  driverPhone:    string | null
  driverPhotoUrl: string | null
  vehicleType:    string | null
  vehiclePlate:   string | null
  agent:          string | null
  bookingStatus:  string
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

const COUNTRY_OPTIONS = [
  { value: '',           label: 'All Countries' },
  { value: 'VIETNAM',   label: 'Vietnam (VN)' },
  { value: 'SRILANKA',  label: 'Sri Lanka (IS)' },
  { value: 'SINGAPORE', label: 'Singapore (SG)' },
  { value: 'MALAYSIA',  label: 'Malaysia (MY)' },
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

// ─── Deep search helpers ──────────────────────────────────────────────────────

function rowMatchesDeep(row: MCRow, q: string): boolean {
  return [
    row.location, row.fromPoint, row.toPoint, row.details,
    row.mealPlan, row.meetingTime, row.vendor, row.driverName,
    row.vehicleType, row.vehiclePlate, row.agent,
    row.vnCode, row.isNumber, row.agentBookingId,
  ].some(v => v?.toLowerCase().includes(q))
}

function getSnippet(text: string, query: string, pad = 30): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, 60)
  const start = Math.max(0, idx - pad)
  const end   = Math.min(text.length, idx + query.length + pad)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

type MatchedField = { label: string; value: string }

function getMatchedFields(row: MCRow, q: string): MatchedField[] {
  const fields: { label: string; value: string | null | undefined }[] = [
    { label: 'Location',  value: row.location },
    { label: 'From',      value: row.fromPoint },
    { label: 'To',        value: row.toPoint },
    { label: 'Details',   value: row.details },
    { label: 'Meal',      value: row.mealPlan },
    { label: 'Meet Time', value: row.meetingTime },
    { label: 'Vendor',    value: row.vendor },
    { label: 'Driver',    value: row.driverName },
    { label: 'Vehicle',   value: row.vehicleType },
    { label: 'Plate',     value: row.vehiclePlate },
    { label: 'Agent',     value: row.agent },
    { label: 'Tour Ref',  value: row.vnCode },
    { label: 'IS No',     value: row.isNumber },
    { label: 'Agent ID',  value: row.agentBookingId },
  ]
  return fields
    .filter(f => f.value?.toLowerCase().includes(q))
    .map(f => ({ label: f.label, value: getSnippet(f.value!, q) }))
}

// ─── Components ───────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 font-semibold rounded-sm px-0.5 not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

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
  const { countryFilter } = useCountryFilter()
  const [rows, setRows]           = useState<MCRow[]>([])
  const [loading, setLoading]     = useState(false)
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [search, setSearch]       = useState('')
  const [deepSearch, setDeepSearch] = useState('')
  const [svcFilter, setSvcFilter]       = useState('')
  const [localCountry, setLocalCountry] = useState('')
  const [activeRange, setActiveRange]   = useState<string | null>(null)
  const [resetNonce, setResetNonce]     = useState(0)
  const [sort, setSort]           = useState<{ field: SortField; dir: SortDir }>({ field: 'date', dir: 'asc' })
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [downloadingXlsx, setDownloadingXlsx] = useState(false)
  const [driverModalRow, setDriverModalRow] = useState<MCRow | null>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // Close export menu on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node))
        setShowExportMenu(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom)    params.set('dateFrom', dateFrom)
      if (dateTo)      params.set('dateTo',   dateTo)
      if (search)      params.set('search',   search)
      if (svcFilter)   params.set('serviceType', svcFilter)
      const effectiveCountry = localCountry || (countryFilter !== 'ALL' ? countryFilter : '')
      if (effectiveCountry) params.set('country', effectiveCountry)

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
  }, [dateFrom, dateTo, search, svcFilter, localCountry, countryFilter])

  useEffect(() => {
    const today = todayISO()
    setDateFrom(today)
    setDateTo(today)
    setActiveRange('Today')
  }, [])

  useEffect(() => {
    if (dateFrom && dateTo) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, svcFilter, resetNonce])

  // ── Quick range ──────────────────────────────────────────────────────────────

  function applyRange(r: typeof QUICK_RANGES[number]) {
    setDateFrom(r.from())
    setDateTo(r.to())
    setActiveRange(r.label)
  }

  function clearFilters() {
    // Reset back to the default view (Today) rather than an empty range, so the
    // data list refreshes instead of staying on the previously-filtered result.
    const today = todayISO()
    setDateFrom(today); setDateTo(today); setSearch(''); setSvcFilter('')
    setLocalCountry(''); setActiveRange('Today'); setDeepSearch('')
    // Bump the nonce so the list always refetches with the cleared filters,
    // even when the date range was already Today (e.g. only a text search was set).
    setResetNonce(n => n + 1)
  }

  // ── Sort ─────────────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    setSort(s => ({
      field,
      dir: s.field === field && s.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    switch (sort.field) {
      case 'date':        return dir * a.date.localeCompare(b.date)
      case 'vnCode':      return dir * a.vnCode.localeCompare(b.vnCode)
      case 'location':    return dir * a.location.localeCompare(b.location)
      case 'serviceType': return dir * a.serviceType.localeCompare(b.serviceType)
      case 'meetingTime': return dir * (a.meetingTime ?? '').localeCompare(b.meetingTime ?? '')
      default:            return 0
    }
  }), [rows, sort])

  // Deep search — client-side filter on already-sorted rows
  const displayedRows = useMemo(() => {
    const q = deepSearch.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(row => rowMatchesDeep(row, q))
  }, [sorted, deepSearch])

  // ── Stats ─────────────────────────────────────────────────────────────────────

  const totalAdults   = displayedRows.reduce((s, r) => s + r.paxAdults, 0)
  const totalChildren = displayedRows.reduce((s, r) => s + r.paxChildren, 0)
  const pvtCount      = displayedRows.filter(r => r.serviceType === 'PVT_TRANSFER').length
  const sicCount      = displayedRows.filter(r => r.serviceType === 'SIC_TRANSFER').length
  const ownCount      = displayedRows.filter(r => r.serviceType === 'OWN_ARRANGEMENT').length

  // ── CSV Export ────────────────────────────────────────────────────────────────

  function downloadCSV() {
    if (displayedRows.length === 0) { toast.error('No data to export'); return }

    const headers = [
      'Date', 'Tour Ref', 'IS Number', 'Agent ID', 'Location', 'Adults', 'Children',
      'From', 'To', 'Details', 'Meal Plan', 'Meeting Time',
      'Service Type', 'Vendor', 'Driver', 'Vehicle Type', 'Plate', 'Agent',
    ]

    const csvRows = displayedRows.map(r => [
      r.date, r.vnCode, r.isNumber ?? '', r.agentBookingId ?? '',
      r.location, r.paxAdults, r.paxChildren,
      r.fromPoint ?? '', r.toPoint ?? '', r.details ?? '',
      r.mealPlan ?? '', r.meetingTime ?? '',
      SERVICE_LABELS[r.serviceType] ?? r.serviceType,
      r.vendor ?? '', r.driverName ?? '', r.vehicleType ?? '', r.vehiclePlate ?? '',
      r.agent ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

    const csv  = [headers.join(','), ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `mc-report-${dateFrom || 'all'}${deepSearch ? `-search-${deepSearch}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${displayedRows.length} rows as CSV`)
    setShowExportMenu(false)
  }

  // ── Excel Export ──────────────────────────────────────────────────────────────

  async function downloadExcel() {
    if (displayedRows.length === 0) { toast.error('No data to export'); return }
    setDownloadingXlsx(true)
    setShowExportMenu(false)
    try {
      const XLSX = await import('xlsx')

      const wb = XLSX.utils.book_new()

      // Sheet 1: Main movements
      const headers = [
        'Date', 'Tour Ref', 'IS Number', 'Agent Booking ID', 'Location',
        'Adults', 'Children', 'From', 'To', 'Details',
        'Meal Plan', 'Meeting Time', 'Service Type',
        'Vendor', 'Driver', 'Vehicle Type', 'Plate No', 'Agent', 'Booking Status',
      ]

      const dataRows = displayedRows.map(r => [
        r.date, r.vnCode, r.isNumber ?? '', r.agentBookingId ?? '',
        r.location, r.paxAdults, r.paxChildren,
        r.fromPoint ?? '', r.toPoint ?? '', r.details ?? '',
        r.mealPlan ?? '', r.meetingTime ?? '',
        SERVICE_LABELS[r.serviceType] ?? r.serviceType,
        r.vendor ?? '', r.driverName ?? '',
        r.vehicleType ?? '', r.vehiclePlate ?? '',
        r.agent ?? '', r.bookingStatus?.replace(/_/g, ' ') ?? '',
      ])

      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
      ws['!cols'] = [
        { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 20 },
        { wch: 7  }, { wch: 8  }, { wch: 22 }, { wch: 22 }, { wch: 40 },
        { wch: 10 }, { wch: 10 }, { wch: 14 },
        { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 16 },
      ]
      XLSX.utils.book_append_sheet(wb, ws, 'Movements')

      // Sheet 2: Stats summary
      const statsData = [
        ['MC Report Summary'],
        ['Generated', new Date().toLocaleString('en-GB')],
        ['Date Range', `${dateFrom || '—'} → ${dateTo || '—'}`],
        deepSearch ? ['Deep Search Filter', deepSearch] : [],
        [''],
        ['Total Movements', displayedRows.length],
        ['Total Adults',    totalAdults],
        ['Total Children',  totalChildren],
        ['Private Transfers', pvtCount],
        ['SIC Transfers',    sicCount],
        ['Own Arrangements', ownCount],
      ].filter(r => r.length > 0)

      const wsSummary = XLSX.utils.aoa_to_sheet(statsData)
      wsSummary['!cols'] = [{ wch: 24 }, { wch: 30 }]
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

      const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      const blob     = new Blob([new Uint8Array(buf)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url      = URL.createObjectURL(blob)
      const a        = document.createElement('a')
      a.href         = url
      a.download     = `mc-report-${dateFrom || 'all'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${displayedRows.length} rows as Excel`)
    } catch {
      toast.error('Excel export failed')
    } finally {
      setDownloadingXlsx(false)
    }
  }

  // ── PDF Export ────────────────────────────────────────────────────────────────

  function openPrintPage() {
    const params = new URLSearchParams()
    if (dateFrom)    params.set('dateFrom', dateFrom)
    if (dateTo)      params.set('dateTo',   dateTo)
    if (search)      params.set('search',   search)
    if (deepSearch)  params.set('deepSearch', deepSearch)
    if (svcFilter)   params.set('serviceType', svcFilter)
    const effectiveCountry = localCountry || (countryFilter !== 'ALL' ? countryFilter : '')
    if (effectiveCountry) params.set('country', effectiveCountry)
    window.open(`/print/mc-report?${params}`, '_blank')
    setShowExportMenu(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const q = deepSearch.trim().toLowerCase()

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

            {/* Export dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(v => !v)}
                className="btn btn-primary btn-sm flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                Export
                <ChevronDownIcon className="w-3 h-3" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-10 z-30 w-56 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider px-4 pt-3 pb-1">
                    {displayedRows.length} row{displayedRows.length !== 1 ? 's' : ''}{deepSearch ? ' · filtered' : ''}
                  </p>
                  <div className="border-t border-slate-100 divide-y divide-slate-100">
                    <button onClick={downloadCSV}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-700 text-left transition-colors">
                      <FileText className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="font-semibold">CSV</p>
                        <p className="text-xs text-slate-400">Comma-separated values</p>
                      </div>
                    </button>
                    <button onClick={downloadExcel} disabled={downloadingXlsx}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-emerald-50 text-sm text-emerald-800 text-left transition-colors disabled:opacity-60">
                      {downloadingXlsx
                        ? <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                        : <FileSpreadsheet className="w-4 h-4 text-emerald-500" />}
                      <div>
                        <p className="font-semibold">{downloadingXlsx ? 'Generating…' : 'Excel (.xlsx)'}</p>
                        <p className="text-xs text-emerald-600">2 sheets: movements + summary</p>
                      </div>
                    </button>
                    <button onClick={openPrintPage}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-blue-50 text-sm text-blue-800 text-left transition-colors">
                      <Printer className="w-4 h-4 text-blue-500" />
                      <div>
                        <p className="font-semibold">PDF (Print)</p>
                        <p className="text-xs text-blue-500">Opens print-ready view</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
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

            {/* Input filters — row 1 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-3">
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Date From
                </label>
                <input type="date" className="form-input" value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setActiveRange(null) }} />
              </div>
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Date To
                </label>
                <input type="date" className="form-input" value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setActiveRange(null) }} />
              </div>
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-400" /> Tour Ref / IS / Agent ID
                </label>
                <input type="text" className="form-input"
                  placeholder="e.g. VN19785, IS48375…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && load()} />
              </div>
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-slate-400" /> Service Type
                </label>
                <select className="form-select" value={svcFilter}
                  onChange={e => setSvcFilter(e.target.value)}>
                  {SERVICE_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-slate-400" /> Country
                </label>
                <select className="form-select" value={localCountry}
                  onChange={e => setLocalCountry(e.target.value)}>
                  {COUNTRY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Deep search — row 2 */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400 pointer-events-none" />
              <input
                type="text"
                className="form-input pl-9 pr-9 border-violet-200 focus:border-violet-400 focus:ring-violet-200 placeholder:text-violet-300"
                placeholder="Deep search — location, from/to, details, hotel, driver, vendor, vehicle plate…"
                value={deepSearch}
                onChange={e => setDeepSearch(e.target.value)}
              />
              {deepSearch && (
                <button type="button" onClick={() => setDeepSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {deepSearch && (
              <p className="text-[11px] text-violet-600 mb-3 flex items-center gap-1">
                <Search className="w-3 h-3" />
                Showing <strong>{displayedRows.length}</strong> of {rows.length} movements matching &ldquo;<strong>{deepSearch}</strong>&rdquo;
              </p>
            )}

            <div className="flex items-center gap-2">
              <button onClick={load} disabled={loading} className="btn btn-primary btn-sm">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
                Apply
              </button>
              <button onClick={clearFilters} className="btn btn-secondary btn-sm">
                <X className="w-4 h-4" /> Clear
              </button>
              {rows.length > 0 && (
                <span className="ml-auto text-xs text-slate-400">
                  {displayedRows.length}{deepSearch ? ` / ${rows.length}` : ''} movement{displayedRows.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </CardBody>
        </Card>

        {/* ── Stats Bar ─────────────────────────────────────────────────── */}
        {displayedRows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { icon: <Table2 className="w-4 h-4" />,  label: 'Movements', value: displayedRows.length, color: 'text-slate-900', bg: 'bg-slate-50' },
              { icon: <Users className="w-4 h-4" />,   label: 'Adults',    value: totalAdults,           color: 'text-blue-700',  bg: 'bg-blue-50' },
              { icon: <Users className="w-4 h-4" />,   label: 'Children',  value: totalChildren,         color: 'text-violet-700', bg: 'bg-violet-50' },
              { icon: <Truck className="w-4 h-4" />,   label: 'Private',   value: pvtCount,              color: 'text-emerald-700', bg: 'bg-emerald-50' },
              { icon: <Truck className="w-4 h-4" />,   label: 'SIC / Own', value: `${sicCount} / ${ownCount}`, color: 'text-amber-700', bg: 'bg-amber-50' },
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
                {loading ? 'Loading…' : `${displayedRows.length} row${displayedRows.length !== 1 ? 's' : ''}`}
                {deepSearch && rows.length !== displayedRows.length && (
                  <span className="text-violet-500 font-medium">· filtered</span>
                )}
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
            ) : displayedRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <MapPin className="w-8 h-8 opacity-30" />
                <p className="text-sm font-medium">
                  {deepSearch ? `No movements contain "${deepSearch}"` : 'No movement items found'}
                </p>
                <p className="text-xs">
                  {deepSearch ? 'Try a different keyword or clear the deep search' : 'Try adjusting the date range or clearing filters'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[1200px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 sticky top-0">
                      <SortTh field="date"        label="Date"      sort={sort} onSort={handleSort} />
                      <SortTh field="vnCode"      label="VN Code"   sort={sort} onSort={handleSort} />
                      <SortTh field="location"    label="Location"  sort={sort} onSort={handleSort} />
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Adults</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Child</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">From</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">To</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Details</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Meal</th>
                      <SortTh field="meetingTime" label="Meet Time" sort={sort} onSort={handleSort} />
                      <SortTh field="serviceType" label="Service"   sort={sort} onSort={handleSort} />
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Driver / Vendor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedRows.map(row => {
                      const isExpanded = expandedRow === row.id
                      const matchedFields = q ? getMatchedFields(row, q) : []

                      // For cells: use getSnippet when deepSearch matches inside truncated text
                      const detailsText = row.details ?? null
                      const showDetailSnippet = q && detailsText && detailsText.toLowerCase().includes(q)
                      const fromText  = row.fromPoint ?? null
                      const toText    = row.toPoint   ?? null

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

                            {/* Booking Ref / IS / Agent ID */}
                            <td className="px-3 py-2.5">
                              <a href={`/dashboard/bookings/${row.vnCode}`} target="_blank" rel="noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="font-mono font-semibold text-brand-700 hover:underline whitespace-nowrap block">
                                {q ? <Highlight text={row.vnCode} query={deepSearch} /> : row.vnCode}
                              </a>
                              {row.isNumber && (
                                <span className="inline-flex items-center mt-0.5 text-[10px] font-semibold font-mono text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                                  IS: {q ? <Highlight text={row.isNumber} query={deepSearch} /> : row.isNumber}
                                </span>
                              )}
                              {row.agentBookingId && (
                                <span className="inline-flex items-center mt-0.5 ml-1 text-[10px] font-semibold font-mono text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                                  {q ? <Highlight text={row.agentBookingId} query={deepSearch} /> : row.agentBookingId}
                                </span>
                              )}
                            </td>

                            {/* Location */}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                <span className="text-slate-700 font-medium">
                                  {q ? <Highlight text={row.location} query={deepSearch} /> : row.location}
                                </span>
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
                                row.paxChildren > 0 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400',
                              )}>
                                {row.paxChildren}
                              </span>
                            </td>

                            {/* From */}
                            <td className="px-3 py-2.5 text-slate-600 max-w-[120px]">
                              {fromText ? (
                                <span className="block truncate" title={fromText}>
                                  {q && fromText.toLowerCase().includes(q)
                                    ? <Highlight text={getSnippet(fromText, deepSearch, 20)} query={deepSearch} />
                                    : fromText}
                                </span>
                              ) : <span className="text-slate-300">—</span>}
                            </td>

                            {/* To */}
                            <td className="px-3 py-2.5 text-slate-600 max-w-[120px]">
                              {toText ? (
                                <span className="block truncate" title={toText}>
                                  {q && toText.toLowerCase().includes(q)
                                    ? <Highlight text={getSnippet(toText, deepSearch, 20)} query={deepSearch} />
                                    : toText}
                                </span>
                              ) : <span className="text-slate-300">—</span>}
                            </td>

                            {/* Details — show snippet around match when deep-searching */}
                            <td className="px-3 py-2.5 text-slate-500 max-w-[200px]">
                              {detailsText ? (
                                showDetailSnippet ? (
                                  <span className="block text-[11px] leading-snug" title={detailsText}>
                                    <Highlight text={getSnippet(detailsText, deepSearch, 35)} query={deepSearch} />
                                  </span>
                                ) : (
                                  <span className="block truncate" title={detailsText}>
                                    {detailsText.length > 45 ? detailsText.slice(0, 45) + '…' : detailsText}
                                  </span>
                                )
                              ) : <span className="text-slate-300">—</span>}
                            </td>

                            {/* Meal Plan */}
                            <td className="px-3 py-2.5">
                              {row.mealPlan
                                ? <MealBadge plan={row.mealPlan} />
                                : <span className="text-slate-300 text-[10px]">—</span>}
                            </td>

                            {/* Meeting Time */}
                            <td className="px-3 py-2.5">
                              {row.meetingTime ? (
                                <div className="flex items-center gap-1 whitespace-nowrap text-slate-700 font-medium">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  {row.meetingTime}
                                </div>
                              ) : <span className="text-slate-300 text-[10px]">—</span>}
                            </td>

                            {/* Service Type */}
                            <td className="px-3 py-2.5">
                              <ServiceBadge type={row.serviceType} />
                            </td>

                            {/* Driver / Vendor */}
                            <td className="px-3 py-2.5 text-slate-600 max-w-[160px]">
                              {row.vendor || row.driverId || row.vendorId ? (
                                <button
                                  onClick={e => { e.stopPropagation(); setDriverModalRow(row) }}
                                  className="flex items-center gap-1.5 max-w-full rounded-full pl-1 pr-2.5 py-1 -ml-1 hover:bg-brand-50 hover:ring-1 hover:ring-brand-200 transition-colors group"
                                >
                                  {row.driverPhotoUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={row.driverPhotoUrl} alt={row.driverName ?? 'Driver'}
                                      className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-white" />
                                  ) : (
                                    <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center flex-shrink-0">
                                      <Truck className="w-3 h-3" />
                                    </span>
                                  )}
                                  <span className="truncate text-slate-700 group-hover:text-brand-700 font-medium" title={row.vendor ?? ''}>
                                    {q && row.vendor && row.vendor.toLowerCase().includes(q)
                                      ? <Highlight text={row.vendor} query={deepSearch} />
                                      : row.vendor ?? 'View details'}
                                  </span>
                                  <ChevronDown className="w-3 h-3 text-slate-300 group-hover:text-brand-400 flex-shrink-0 -rotate-90" />
                                </button>
                              ) : <span className="text-slate-300 text-[10px]">—</span>}
                            </td>
                          </tr>

                          {/* Expanded detail row */}
                          {isExpanded && (
                            <tr key={`${row.id}-detail`} className="bg-brand-50/40 border-l-2 border-l-brand-400">
                              <td colSpan={12} className="px-4 py-3">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                                  {[
                                    { label: 'Tour Ref',       value: row.vnCode },
                                    { label: 'IS Number',      value: row.isNumber },
                                    { label: 'Agent ID',       value: row.agentBookingId },
                                    { label: 'Agent',          value: row.agent },
                                    { label: 'Full Details',   value: row.details },
                                    { label: 'Driver',         value: row.driverName },
                                    { label: 'Vehicle Type',   value: row.vehicleType },
                                    { label: 'Vehicle Plate',  value: row.vehiclePlate },
                                    { label: 'Booking Status', value: row.bookingStatus?.replace(/_/g, ' ') },
                                    { label: 'Pax',            value: `${row.paxAdults} Adults, ${row.paxChildren} Children` },
                                    { label: 'Driver / Vendor', value: row.vendor },
                                  ].map(item =>
                                    item.value ? (
                                      <div key={item.label}>
                                        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">{item.label}</p>
                                        <p className="text-slate-700 font-medium font-mono">
                                          {q ? <Highlight text={item.value} query={deepSearch} /> : item.value}
                                        </p>
                                      </div>
                                    ) : null
                                  )}
                                </div>

                                {/* Matched-in chips when deep search is active */}
                                {q && matchedFields.length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-brand-100">
                                    <p className="text-[10px] uppercase tracking-wide text-violet-500 font-semibold mb-2 flex items-center gap-1">
                                      <Search className="w-3 h-3" /> Matched in:
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {matchedFields.map((f, fi) => (
                                        <span key={fi} className="inline-flex items-start gap-1 px-2 py-1 rounded border border-violet-200 bg-violet-50 text-[11px] text-violet-800 leading-snug max-w-xs">
                                          <span className="font-bold flex-shrink-0">{f.label}:</span>
                                          <span className="break-words min-w-0">
                                            <Highlight text={f.value} query={deepSearch} />
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
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

      <DriverVendorModal
        open={driverModalRow !== null}
        onClose={() => setDriverModalRow(null)}
        driverId={driverModalRow?.driverId}
        vendorId={driverModalRow?.vendorId}
        fallback={{
          driverName:   driverModalRow?.driverName,
          driverPhone:  driverModalRow?.driverPhone,
          vehicleType:  driverModalRow?.vehicleType,
          vehiclePlate: driverModalRow?.vehiclePlate,
          vendorName:   driverModalRow?.vendor,
        }}
      />
    </div>
  )
}
