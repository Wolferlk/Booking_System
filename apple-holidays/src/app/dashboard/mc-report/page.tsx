'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSession } from 'next-auth/react'
import {
  Loader2, Download, Filter, X, Calendar, Search,
  Users, Truck, MapPin, Clock, ChevronUp, ChevronDown,
  ClipboardList, RefreshCw, Table2, Globe, FileText,
  FileSpreadsheet, Printer, ChevronDown as ChevronDownIcon, Palmtree, Hotel,
  Sparkles, Store, UserPlus, Phone, XCircle, Ban, ExternalLink,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { toast } from 'sonner'
import { cn, formatDate, formatCurrency } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'
import DriverVendorModal from '@/components/shared/driver-vendor-modal'
import AssignMovementModal, { type MovementAssignment } from '@/components/shared/assign-movement-modal'
import { isPartnerEnabledForCountry, PARTNER_CONFIG, type PartnerKind } from '@/lib/partner-directory'
import type { UserRole } from '@prisma/client'
import {
  SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, SERVICE_TYPE_SHORT_LABELS,
  isPrivateTransferType, isSicType, type ServiceTypeValue,
} from '@/lib/service-types'
import { to12h } from '@/lib/clock-time'

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = ServiceTypeValue

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
  /** Free / at-leisure day — no driver is allocated for this movement. */
  isLeisure:      boolean
  /** Hotel only — accommodation or own transport, so likewise no driver. */
  isHotelOnly:    boolean
  /**
   * The whole booking is Hotel Only — accommodation and nothing else. These
   * files carry no agenda at all, so the row is a *stay* the server built from
   * the accommodation rather than a movement anyone planned. See
   * `src/lib/hotel-only.ts`.
   */
  isHotelOnlyBooking: boolean
  /** Stay rows only: `yyyy-mm-dd` the guest checks out. */
  checkOut:       string | null
  /** Stay rows only: nights at this property. */
  nights:         number | null
  vendor:         string | null
  /** Transport vendor's own name — `vendor` above falls back to the driver. */
  vendorName:     string | null
  driverId:       string | null
  vendorId:       string | null
  driverName:     string | null
  driverPhone:    string | null
  driverPhotoUrl: string | null
  vehicleType:    string | null
  vehiclePlate:   string | null
  driverRate:     number | null
  rateCurrency:   string | null
  guideId:         string | null
  guideName:       string | null
  guidePhone:      string | null
  tourVendorId:    string | null
  tourVendorName:  string | null
  tourVendorPhone: string | null
  /** Booking's operation country — decides which partner columns apply. */
  operationCountry: string | null
  agent:          string | null
  bookingStatus:  string
  /** Cancellation-approval trail — set once a cancellation has been requested. */
  cancelRequestedAt: string | null
  cancelRequestedBy: string | null
  cancelReason:      string | null
  cancelFeeTotal:    number | null
  /** Status the file is held at while accounts decides. */
  cancelHeldAt:      string | null
  currency:          string | null
}

/**
 * The booking behind this movement has been cancelled.
 *
 * Cancelled files are deliberately still charted: a driver is allocated against
 * these movements and the desk needs to see, on the chart it works from, that
 * the tour is off — a row that silently disappears is the one somebody still
 * turns up for. They are badged and struck through instead, and left out of the
 * pax and service-type totals, which describe work we are actually running.
 */
function isCancelledRow(row: { bookingStatus?: string | null }): boolean {
  const s = String(row.bookingStatus ?? '')
  return s === 'CANCELLED' || s === 'PENDING_CANCELLATION'
}

/**
 * A cancellation has been *requested* on this file and accounts has not decided.
 *
 * Kept apart from `isCancelledRow` above, which covers both states: a pending
 * request is not a cancellation yet. The movement is still scheduled, the driver
 * is still expected to turn up, and somebody is about to be told not to — which
 * is exactly why the chart has to say so rather than quietly grey the row out.
 */
function isCancelPendingRow(row: { bookingStatus?: string | null }): boolean {
  return String(row.bookingStatus ?? '') === 'PENDING_CANCELLATION'
}

/** Whole days a request has been waiting on accounts. */
function waitingDays(requestedAt: string | null): number | null {
  if (!requestedAt) return null
  const then = Date.parse(requestedAt)
  if (isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

/** "raised today", "waiting 4 days" — how a queued request describes itself. */
function waitLabel(days: number | null): string {
  if (days == null) return 'awaiting approval'
  if (days === 0) return 'raised today'
  return `waiting ${days} day${days === 1 ? '' : 's'}`
}

/**
 * A request raised this morning is routine; one sitting unanswered for days is
 * costing money — every hour it waits, more drivers and tickets go against a
 * file that may be dead — so the colour escalates rather than staying flat.
 */
function waitTone(days: number | null): { border: string; chip: string; text: string } {
  if (days != null && days >= 3) {
    return { border: 'border-rose-300', chip: 'bg-rose-100 text-rose-800 border-rose-300', text: 'text-rose-700' }
  }
  if (days != null && days >= 1) {
    return { border: 'border-orange-300', chip: 'bg-orange-100 text-orange-800 border-orange-300', text: 'text-orange-700' }
  }
  return { border: 'border-amber-300', chip: 'bg-amber-100 text-amber-800 border-amber-300', text: 'text-amber-700' }
}

type SortField = 'date' | 'vnCode' | 'agent' | 'location' | 'serviceType' | 'meetingTime'
type SortDir   = 'asc' | 'desc'

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = SERVICE_TYPE_SHORT_LABELS

const SERVICE_COLORS: Record<string, string> = {
  PVT_TRANSFER:          'bg-emerald-100 text-emerald-700 ring-emerald-200',
  PVT_TOUR:              'bg-emerald-100 text-emerald-700 ring-emerald-200',
  PVT_TRANSFER_TICKET:   'bg-purple-100 text-purple-700 ring-purple-200',
  PVT_TRANSFER_SPA:      'bg-teal-100 text-teal-700 ring-teal-200',
  PVT_TRANSFER_SIC_TOUR: 'bg-teal-100 text-teal-700 ring-teal-200',
  PVT_TRANSFER_MEAL:     'bg-orange-100 text-orange-700 ring-orange-200',
  SIC_TRANSFER:          'bg-blue-100 text-blue-700 ring-blue-200',
  SIC_TOUR:              'bg-blue-100 text-blue-700 ring-blue-200',
  MEAL_COUPON:           'bg-orange-100 text-orange-700 ring-orange-200',
  INTERNAL_TOUR:         'bg-purple-100 text-purple-700 ring-purple-200',
  ACCOMMODATION:         'bg-amber-100 text-amber-700 ring-amber-200',
  OWN_ARRANGEMENT:       'bg-slate-100 text-slate-600 ring-slate-200',
}

const MEAL_COLORS: Record<string, string> = {
  BB:  'bg-amber-100 text-amber-700',
  HB:  'bg-orange-100 text-orange-700',
  FB:  'bg-rose-100 text-rose-700',
  AI:  'bg-purple-100 text-purple-700',
  RO:  'bg-slate-100 text-slate-600',
}

const SERVICE_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  ...SERVICE_TYPE_VALUES.filter(v => v !== 'FLIGHT')
    .map(v => ({ value: v as string, label: SERVICE_TYPE_LABELS[v] })),
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
    row.guideName, row.tourVendorName,
    row.vehicleType, row.vehiclePlate, row.agent,
    row.vnCode, row.isNumber, row.agentBookingId,
    // Searchable by name: typing "hotel only" pulls up every accommodation-only
    // file, which is the fastest way to answer "who has no tour this week?"
    row.isHotelOnlyBooking ? 'hotel only booking accommodation only' : null,
    // Same trick for the approval queue: "cancel pending" pulls up every file
    // waiting on accounts, and the reason text is searchable with it.
    isCancelPendingRow(row)
      ? `cancel pending cancellation approval ${row.cancelReason ?? ''} ${row.cancelRequestedBy ?? ''}`
      : null,
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
    { label: 'Meet Time', value: to12h(row.meetingTime) },
    { label: 'Vendor',    value: row.vendor },
    { label: 'Driver',    value: row.driverName },
    { label: 'Guide',       value: row.guideName },
    { label: 'Tour Vendor', value: row.tourVendorName },
    { label: 'Vehicle',   value: row.vehicleType },
    { label: 'Plate',     value: row.vehiclePlate },
    { label: 'Agent',     value: row.agent },
    { label: 'Tour Ref',  value: row.vnCode },
    { label: 'IS No',     value: row.isNumber },
    { label: 'Agent ID',  value: row.agentBookingId },
    { label: 'Cancel Reason', value: row.cancelReason },
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

/** Marks a free / at-leisure day, where no driver is allocated by design. */
function LeisureBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ring-1 bg-amber-100 text-amber-700 ring-amber-200 whitespace-nowrap">
      <Palmtree className="w-3 h-3" />
      Leisure Day
    </span>
  )
}

/**
 * Marks a whole booking sold as accommodation only.
 *
 * Deliberately a different colour and wording from `HotelOnlyBadge` below: that
 * one says "this movement needs no driver", this one says "there is no tour at
 * all — the row you are looking at is a hotel stay". Reading them as the same
 * thing would have an operator hunting for a movement chart that will never
 * exist.
 */
function HotelOnlyBookingBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ring-1 bg-amber-100 text-amber-800 ring-amber-300 whitespace-nowrap"
      title="Hotel Only booking — accommodation only. No agenda, drivers, tickets, flights, client reconfirmation or QC."
    >
      <Hotel className="w-3 h-3" />
      Hotel Only Booking
    </span>
  )
}

/** Marks a hotel-only movement, where no driver is allocated by design. */
function HotelOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ring-1 bg-pink-100 text-pink-700 ring-pink-200 whitespace-nowrap">
      <Hotel className="w-3 h-3" />
      Hotel Only
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

/**
 * Whether anybody can be assigned to this row at all.
 *
 * Leisure days, hotel-only movements and Hotel Only bookings carry no transport
 * by design — the row explains why instead of offering an assign button that
 * would contradict the badge sitting next to it. Hotel Only stays are not even
 * agenda items, so there is nothing to attach an assignment to.
 */
function isAssignable(row: MCRow): boolean {
  return !row.isHotelOnlyBooking && !row.isHotelOnly && !row.isLeisure
}

/**
 * Guide / tour-vendor cell.
 *
 * Three states, and they mean different things: a name, an empty slot the
 * country does operate with (so it can be filled), and a country that does not
 * use this partner kind at all — which reads as "not applicable" rather than
 * "missing", so nobody chases a guide for a country that never books one.
 */
function PartnerCell({
  kind, name, phone, enabled, canAssign, onAssign, query,
}: {
  kind: PartnerKind
  name: string | null
  phone: string | null
  enabled: boolean
  canAssign: boolean
  onAssign: () => void
  query: string
}) {
  const config = PARTNER_CONFIG[kind]
  const Icon = kind === 'guide' ? Sparkles : Store
  const q = query.trim().toLowerCase()

  if (!enabled) {
    return (
      <span className="text-slate-300 text-[10px]" title={`${config.labelPlural} are not switched on for this country`}>
        n/a
      </span>
    )
  }

  if (!name) {
    return canAssign ? (
      <button
        onClick={e => { e.stopPropagation(); onAssign() }}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-brand-700 rounded px-1.5 py-0.5 hover:bg-brand-50 transition-colors"
      >
        <UserPlus className="w-3 h-3" /> Assign
      </button>
    ) : <span className="text-slate-300 text-[10px]">—</span>
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); if (canAssign) onAssign() }}
      className={cn(
        'flex items-center gap-1.5 max-w-full rounded-full pl-1 pr-2 py-0.5 -ml-1 transition-colors text-left',
        canAssign && 'hover:bg-slate-50 hover:ring-1 hover:ring-slate-200',
      )}
      title={phone ? `${name} · ${phone}` : name}
    >
      <span className={cn('w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0', config.accent.bg)}>
        <Icon className={cn('w-3 h-3', config.accent.text)} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-slate-700">
          {q && name.toLowerCase().includes(q) ? <Highlight text={name} query={query} /> : name}
        </span>
        {phone && (
          <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
            <Phone className="w-2.5 h-2.5" />{phone}
          </span>
        )}
      </span>
    </button>
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

const ASSIGN_ROLES: UserRole[] = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export default function MCReportPage() {
  const { countryFilter } = useCountryFilter()
  const { data: session } = useSession()
  const canAssign = ASSIGN_ROLES.includes(session?.user?.role as UserRole)
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
  /** Narrow the chart to movements on files awaiting a cancellation decision. */
  const [cancelOnly, setCancelOnly] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [downloadingXlsx, setDownloadingXlsx] = useState(false)
  const [driverModalRow, setDriverModalRow] = useState<MCRow | null>(null)
  const [assignRow, setAssignRow] = useState<MCRow | null>(null)
  // Which partner kinds each country operates with (Settings-driven), so the
  // guide / tour-vendor columns only appear where they are actually used.
  const [partnerCountries, setPartnerCountries] = useState<Record<PartnerKind, string[]>>({ guide: [], tourVendor: [] })
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/public/partner-settings')
      .then(r => r.json())
      .then(json => { if (json.success) setPartnerCountries(json.data) })
      .catch(() => { /* leave both off — the chart works exactly as before */ })
  }, [])

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
    setLocalCountry(''); setActiveRange('Today'); setDeepSearch(''); setCancelOnly(false)
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
      case 'agent':       return dir * (a.agent ?? '').localeCompare(b.agent ?? '')
      case 'location':    return dir * a.location.localeCompare(b.location)
      case 'serviceType': return dir * a.serviceType.localeCompare(b.serviceType)
      case 'meetingTime': return dir * (a.meetingTime ?? '').localeCompare(b.meetingTime ?? '')
      default:            return 0
    }
  }), [rows, sort])

  // Deep search — client-side filter on already-sorted rows
  const displayedRows = useMemo(() => {
    const q = deepSearch.trim().toLowerCase()
    const base = cancelOnly ? sorted.filter(isCancelPendingRow) : sorted
    if (!q) return base
    return base.filter(row => rowMatchesDeep(row, q))
  }, [sorted, deepSearch, cancelOnly])

  // ── Guides / tour vendors ─────────────────────────────────────────────────────

  const guideEnabledFor      = useCallback(
    (row: MCRow) => isPartnerEnabledForCountry(partnerCountries.guide, row.operationCountry),
    [partnerCountries.guide],
  )
  const tourVendorEnabledFor = useCallback(
    (row: MCRow) => isPartnerEnabledForCountry(partnerCountries.tourVendor, row.operationCountry),
    [partnerCountries.tourVendor],
  )

  // The columns are only worth their width when something in view can use them:
  // a chart of Vietnam movements does not carry a tour-vendor column when
  // Vietnam does not book tour vendors.
  const showGuideCol      = useMemo(
    () => displayedRows.some(r => guideEnabledFor(r) || r.guideName),
    [displayedRows, guideEnabledFor],
  )
  const showTourVendorCol = useMemo(
    () => displayedRows.some(r => tourVendorEnabledFor(r) || r.tourVendorName),
    [displayedRows, tourVendorEnabledFor],
  )

  /** Fold a saved assignment back into the row, so the chart updates in place. */
  function applyAssignment(rowId: string, next: MovementAssignment | null) {
    setRows(rs => rs.map(r => r.id !== rowId ? r : {
      ...r,
      driverId:       next?.driverId     ?? null,
      vendorId:       next?.vendorId     ?? null,
      driverName:     next?.driverName   ?? null,
      driverPhone:    next?.driverPhone  ?? null,
      vehicleType:    next?.vehicleType  ?? null,
      vehiclePlate:   next?.vehiclePlate ?? null,
      vendorName:     next?.vendorName   ?? null,
      vendor:         next?.vendorName   ?? next?.driverName ?? null,
      driverPhotoUrl: next?.driverId && next.driverId === r.driverId ? r.driverPhotoUrl : null,
      driverRate:     next?.driverRate   ?? null,
      rateCurrency:   next?.rateCurrency ?? null,
      guideId:         next?.guideId         ?? null,
      guideName:       next?.guideName       ?? null,
      guidePhone:      next?.guidePhone      ?? null,
      tourVendorId:    next?.tourVendorId    ?? null,
      tourVendorName:  next?.tourVendorName  ?? null,
      tourVendorPhone: next?.tourVendorPhone ?? null,
    }))
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  // Cancelled movements stay in the table but out of every total: pax on a
  // cancelled file are not travelling and its transfers are not being driven.
  const liveRows      = useMemo(() => displayedRows.filter(r => !isCancelledRow(r)), [displayedRows])
  const cancelledRowCount = displayedRows.length - liveRows.length
  const cancelledBookingCount = useMemo(
    () => new Set(displayedRows.filter(isCancelledRow).map(r => r.vnCode)).size,
    [displayedRows],
  )

  /**
   * One entry per booking whose cancellation is sitting with accounts, with the
   * movements still charted against it.
   *
   * Built from the whole loaded chart rather than the filtered view: this is an
   * alert, and an alert that vanishes because somebody typed a hotel name into
   * deep search is one nobody can trust. Longest wait first — that request is
   * the one costing the most, because work has kept going on it all week.
   */
  const cancelQueue = useMemo(() => {
    const byBooking = new Map<string, {
      vnCode: string; isNumber: string | null; agent: string | null
      movements: number; adults: number; children: number
      firstDate: string; lastDate: string
      requestedAt: string | null; requestedBy: string | null
      reason: string | null; feeTotal: number | null
      heldAt: string | null; currency: string | null
      driversAssigned: number
      days: number | null
    }>()

    for (const r of rows) {
      if (!isCancelPendingRow(r)) continue
      const e = byBooking.get(r.vnCode)
      if (!e) {
        byBooking.set(r.vnCode, {
          vnCode: r.vnCode, isNumber: r.isNumber, agent: r.agent,
          movements: 1, adults: r.paxAdults, children: r.paxChildren,
          firstDate: r.date, lastDate: r.date,
          requestedAt: r.cancelRequestedAt, requestedBy: r.cancelRequestedBy,
          reason: r.cancelReason, feeTotal: r.cancelFeeTotal,
          heldAt: r.cancelHeldAt, currency: r.currency,
          driversAssigned: r.driverId || r.driverName ? 1 : 0,
          days: waitingDays(r.cancelRequestedAt),
        })
        continue
      }
      e.movements += 1
      // Pax are a property of the booking, not the movement — read once, from
      // the first row, so a five-day file does not report five times its pax.
      if (r.date < e.firstDate) e.firstDate = r.date
      if (r.date > e.lastDate)  e.lastDate  = r.date
      if (r.driverId || r.driverName) e.driversAssigned += 1
    }

    return Array.from(byBooking.values())
      .sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || a.firstDate.localeCompare(b.firstDate))
  }, [rows])

  const cancelQueueMovements = cancelQueue.reduce((s, e) => s + e.movements, 0)
  const cancelQueuePax       = cancelQueue.reduce((s, e) => s + e.adults + e.children, 0)
  const cancelQueueDrivers   = cancelQueue.reduce((s, e) => s + e.driversAssigned, 0)
  const cancelQueueOldest    = cancelQueue.reduce<number | null>(
    (m, e) => e.days == null ? m : m == null ? e.days : Math.max(m, e.days), null)

  const totalAdults   = liveRows.reduce((s, r) => s + r.paxAdults, 0)
  const totalChildren = liveRows.reduce((s, r) => s + r.paxChildren, 0)
  const pvtCount      = liveRows.filter(r => isPrivateTransferType(r.serviceType)).length
  const sicCount      = liveRows.filter(r => isSicType(r.serviceType)).length
  const ownCount      = liveRows.filter(r => r.serviceType === 'OWN_ARRANGEMENT').length
  const leisureCount  = liveRows.filter(r => r.isLeisure).length
  const hotelOnlyCount = liveRows.filter(r => r.isHotelOnly).length
  // Distinct *bookings*, not rows: a five-night file across two properties is
  // one Hotel Only booking on this chart, however many stays it contributes.
  const hotelOnlyBookingCount = useMemo(
    () => new Set(displayedRows.filter(r => r.isHotelOnlyBooking).map(r => r.vnCode)).size,
    [displayedRows],
  )
  const hotelOnlyStayCount = displayedRows.filter(r => r.isHotelOnlyBooking).length

  // ── CSV Export ────────────────────────────────────────────────────────────────

  function downloadCSV() {
    if (displayedRows.length === 0) { toast.error('No data to export'); return }

    const headers = [
      'Date', 'Tour Ref', 'IS Number', 'Agent ID', 'Location', 'Adults', 'Children',
      'From', 'To', 'Details', 'Meal Plan', 'Meeting Time',
      'Booking Status', 'Cancelled', 'Cancel Approval', 'Cancel Requested On',
      'Cancel Requested By', 'Days Awaiting Approval', 'Cancel Reason', 'Cancellation Fee',
      'Service Type', 'Leisure Day', 'Hotel Only', 'Hotel Only Booking', 'Nights', 'Check Out',
      'Vendor', 'Driver', 'Vehicle Type', 'Plate',
      'Guide', 'Guide Phone', 'Tour Vendor', 'Tour Vendor Phone', 'Agent',
    ]

    const csvRows = displayedRows.map(r => [
      r.date, r.vnCode, r.isNumber ?? '', r.agentBookingId ?? '',
      r.location, r.paxAdults, r.paxChildren,
      r.fromPoint ?? '', r.toPoint ?? '', r.details ?? '',
      r.mealPlan ?? '', r.meetingTime ?? '',
      r.bookingStatus?.replace(/_/g, ' ') ?? '',
      isCancelledRow(r) ? 'CANCELLED' : '',
      // Split out from 'Cancelled' above: a spreadsheet pivot has to be able to
      // tell a dead file from one still waiting on a decision.
      isCancelPendingRow(r) ? 'AWAITING APPROVAL' : r.bookingStatus === 'CANCELLED' ? 'Approved / cancelled' : '',
      r.cancelRequestedAt?.slice(0, 10) ?? '',
      r.cancelRequestedBy ?? '',
      isCancelPendingRow(r) ? waitingDays(r.cancelRequestedAt) ?? '' : '',
      r.cancelReason ?? '',
      r.cancelFeeTotal ?? '',
      SERVICE_LABELS[r.serviceType] ?? r.serviceType,
      r.isLeisure ? 'Yes' : '',
      r.isHotelOnly ? 'Yes' : '',
      r.isHotelOnlyBooking ? 'Yes' : '',
      r.nights ?? '', r.checkOut ?? '',
      r.vendor ?? '', r.driverName ?? '', r.vehicleType ?? '', r.vehiclePlate ?? '',
      r.guideName ?? '', r.guidePhone ?? '',
      r.tourVendorName ?? '', r.tourVendorPhone ?? '',
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
        'Meal Plan', 'Meeting Time', 'Service Type', 'Leisure Day', 'Hotel Only',
        'Hotel Only Booking', 'Nights', 'Check Out',
        'Vendor', 'Driver', 'Vehicle Type', 'Plate No',
        'Guide', 'Guide Phone', 'Tour Vendor', 'Tour Vendor Phone',
        'Agent', 'Booking Status',
        'Cancel Approval', 'Cancel Requested On', 'Cancel Requested By',
        'Days Awaiting Approval', 'Cancel Reason', 'Cancellation Fee',
      ]

      const dataRows = displayedRows.map(r => [
        r.date, r.vnCode, r.isNumber ?? '', r.agentBookingId ?? '',
        r.location, r.paxAdults, r.paxChildren,
        r.fromPoint ?? '', r.toPoint ?? '', r.details ?? '',
        r.mealPlan ?? '', r.meetingTime ?? '',
        SERVICE_LABELS[r.serviceType] ?? r.serviceType,
        r.isLeisure ? 'Yes' : '',
        r.isHotelOnly ? 'Yes' : '',
        r.isHotelOnlyBooking ? 'Yes' : '',
        r.nights ?? '', r.checkOut ?? '',
        r.vendor ?? '', r.driverName ?? '',
        r.vehicleType ?? '', r.vehiclePlate ?? '',
        r.guideName ?? '', r.guidePhone ?? '',
        r.tourVendorName ?? '', r.tourVendorPhone ?? '',
        r.agent ?? '', r.bookingStatus?.replace(/_/g, ' ') ?? '',
        isCancelPendingRow(r) ? 'AWAITING APPROVAL' : r.bookingStatus === 'CANCELLED' ? 'Approved / cancelled' : '',
        r.cancelRequestedAt?.slice(0, 10) ?? '',
        r.cancelRequestedBy ?? '',
        isCancelPendingRow(r) ? waitingDays(r.cancelRequestedAt) ?? '' : '',
        r.cancelReason ?? '',
        r.cancelFeeTotal ?? '',
      ])

      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
      ws['!cols'] = [
        { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 20 },
        { wch: 7  }, { wch: 8  }, { wch: 22 }, { wch: 22 }, { wch: 40 },
        { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
        { wch: 18 }, { wch: 8  }, { wch: 12 },
        { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 12 },
        { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 16 },
        { wch: 18 }, { wch: 16 },
        { wch: 20 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 40 }, { wch: 14 },
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
        ['Leisure Days',     leisureCount],
        ['Hotel Only',       hotelOnlyCount],
        ['Hotel Only Bookings', hotelOnlyBookingCount],
        ['Hotel Only Stays',    hotelOnlyStayCount],
        ['Cancelled Bookings',  cancelledBookingCount],
        ['Cancelled Movements', cancelledRowCount],
        ['Cancellations Awaiting Accounts Approval', cancelQueue.length],
        ['Movements On Files Awaiting Approval',     cancelQueueMovements],
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

            {cancelOnly && (
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold text-orange-700">
                <Ban className="h-3 w-3" />
                Showing only movements on files awaiting a cancellation decision —
                <button type="button" onClick={() => setCancelOnly(false)} className="underline hover:text-orange-900">
                  show everything
                </button>
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

        {/* ── Cancellation approvals pending ────────────────────────────── */}
        {/*
            Above the chart, not inside it. Every movement listed here is still
            scheduled — a driver is expected to turn up, a ticket may already be
            issued — while somebody has asked for the file to be cancelled and
            accounts has not answered. The chart cannot let that sit as one
            struck-through row halfway down a 400-row table.
        */}
        {cancelQueue.length > 0 && (
          <div className={cn(
            'relative overflow-hidden rounded-2xl border-2 bg-white shadow-sm',
            waitTone(cancelQueueOldest).border,
          )}>
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-rose-50 via-orange-50/60 to-transparent" />

            <div className="relative p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className={cn(
                    'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border',
                    waitTone(cancelQueueOldest).chip,
                  )}>
                    <Ban className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
                      Cancellation approvals pending
                      <span className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold',
                        waitTone(cancelQueueOldest).chip,
                      )}>
                        {cancelQueue.length} booking{cancelQueue.length === 1 ? '' : 's'}
                      </span>
                    </h3>
                    <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-600">
                      A cancellation has been requested on {cancelQueue.length === 1 ? 'this file' : 'these files'} and
                      the accounts team has not decided yet. The movements below are still on the chart and still
                      expected to run — hold off committing anything new until the decision comes back.
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Table2 className="h-3 w-3 text-slate-400" />
                        <strong className="text-slate-800">{cancelQueueMovements}</strong> movement{cancelQueueMovements === 1 ? '' : 's'} on the chart
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3 text-slate-400" />
                        <strong className="text-slate-800">{cancelQueuePax}</strong> pax
                      </span>
                      {cancelQueueDrivers > 0 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                          <Truck className="h-3 w-3" />
                          {cancelQueueDrivers} already allocated a driver
                        </span>
                      )}
                      {cancelQueueOldest != null && (
                        <span className={cn('inline-flex items-center gap-1 font-semibold', waitTone(cancelQueueOldest).text)}>
                          <Clock className="h-3 w-3" />
                          oldest {waitLabel(cancelQueueOldest)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCancelOnly(v => !v)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors',
                    cancelOnly
                      ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {cancelOnly ? 'Show all movements' : 'Show only these movements'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {cancelQueue.map(e => {
                  const tone = waitTone(e.days)
                  return (
                    <div key={e.vnCode}
                      className={cn('rounded-xl border bg-white/90 p-3 shadow-sm transition-shadow hover:shadow-md', tone.border)}>
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={`/dashboard/bookings/${e.vnCode}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-sm font-bold text-brand-700 hover:underline"
                        >
                          {e.vnCode}
                          <ExternalLink className="h-3 w-3 text-slate-400" />
                        </a>
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                          tone.chip,
                        )}>
                          <Clock className="h-2.5 w-2.5" />
                          {waitLabel(e.days)}
                        </span>
                      </div>

                      <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
                        <div className="truncate">
                          {e.isNumber || '—'}
                          <span className="text-slate-400"> · {e.agent || 'no agent'}</span>
                        </div>
                        <div>
                          {formatDate(e.firstDate)}{e.lastDate !== e.firstDate ? ` → ${formatDate(e.lastDate)}` : ''}
                          <span className="text-slate-400">
                            {' '}· {e.movements} movement{e.movements === 1 ? '' : 's'} · {e.adults + e.children} pax
                          </span>
                        </div>
                        <div className="truncate text-slate-400">
                          Requested by {e.requestedBy || 'unknown'}
                          {e.heldAt ? ` · held at ${e.heldAt.replace(/_/g, ' ').toLowerCase()}` : ''}
                        </div>
                      </div>

                      {e.reason && (
                        <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] italic text-slate-600 line-clamp-2"
                          title={e.reason}>
                          &ldquo;{e.reason}&rdquo;
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {e.feeTotal != null && e.feeTotal > 0 && (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                            Fee {formatCurrency(e.feeTotal, e.currency ?? 'USD')}
                          </span>
                        )}
                        {/* The number that decides whether somebody picks up the
                            phone right now: a driver already told to be there. */}
                        {e.driversAssigned > 0 && (
                          <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">
                            {e.driversAssigned} driver{e.driversAssigned === 1 ? '' : 's'} allocated
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Stats Bar ─────────────────────────────────────────────────── */}
        {displayedRows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              // Movements counts every charted row; the subtitle owns up to how
              // many of them belong to a cancelled file, since the pax and
              // service tiles beside it exclude those.
              { icon: <Table2 className="w-4 h-4" />,  label: 'Movements', value: displayedRows.length, sub: cancelledRowCount > 0 ? `${cancelledRowCount} cancelled` : undefined, color: 'text-slate-900', bg: 'bg-slate-50' },
              { icon: <Users className="w-4 h-4" />,   label: 'Adults',    value: totalAdults,           color: 'text-blue-700',  bg: 'bg-blue-50' },
              { icon: <Users className="w-4 h-4" />,   label: 'Children',  value: totalChildren,         color: 'text-violet-700', bg: 'bg-violet-50' },
              { icon: <Truck className="w-4 h-4" />,   label: 'Private',   value: pvtCount,              color: 'text-emerald-700', bg: 'bg-emerald-50' },
              { icon: <Truck className="w-4 h-4" />,   label: 'SIC / Own', value: `${sicCount} / ${ownCount}`, color: 'text-amber-700', bg: 'bg-amber-50' },
              { icon: <Palmtree className="w-4 h-4" />, label: 'Leisure',  value: leisureCount,          color: 'text-amber-700', bg: 'bg-amber-50' },
              { icon: <Hotel className="w-4 h-4" />, label: 'Hotel Only', value: hotelOnlyCount,       color: 'text-pink-700', bg: 'bg-pink-50' },
              // Bookings, not rows — see `hotelOnlyBookingCount`. The stay count
              // rides along as a subtitle so the two are never confused.
              { icon: <Hotel className="w-4 h-4" />, label: 'Hotel Only Bookings', value: hotelOnlyBookingCount, sub: `${hotelOnlyStayCount} stay${hotelOnlyStayCount === 1 ? '' : 's'}`, color: 'text-amber-800', bg: 'bg-amber-50' },
              ...(cancelledBookingCount > 0
                ? [{ icon: <XCircle className="w-4 h-4" />, label: 'Cancelled', value: cancelledBookingCount, sub: `${cancelledRowCount} movement${cancelledRowCount === 1 ? '' : 's'}`, color: 'text-rose-700', bg: 'bg-rose-50' }]
                : []),
              // Counted over the whole loaded chart, like the panel above it —
              // the tile and the alert must never disagree about how many files
              // are waiting on accounts.
              ...(cancelQueue.length > 0
                ? [{ icon: <Ban className="w-4 h-4" />, label: 'Cancel Pending', value: cancelQueue.length, sub: `${cancelQueueMovements} movement${cancelQueueMovements === 1 ? '' : 's'} · awaiting accounts`, color: 'text-orange-700', bg: 'bg-orange-50' }]
                : []),
            ].map(stat => (
              <div key={stat.label} className={cn('rounded-xl p-4 border border-slate-200 flex items-center gap-3 shadow-sm', stat.bg)}>
                <div className={cn('flex-shrink-0', stat.color)}>{stat.icon}</div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">{stat.label}</div>
                  <div className={cn('text-lg font-bold leading-tight', stat.color)}>{stat.value}</div>
                  {'sub' in stat && stat.sub ? (
                    <div className="text-[10px] text-slate-400 leading-tight">{stat.sub}</div>
                  ) : null}
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
                      <SortTh field="agent"       label="Agent"     sort={sort} onSort={handleSort} />
                      <SortTh field="location"    label="Location"  sort={sort} onSort={handleSort} />
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Adults</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Child</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">From</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">To</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Details</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Meal</th>
                      <SortTh field="meetingTime" label="Meet Time" sort={sort} onSort={handleSort} />
                      <SortTh field="serviceType" label="Service"   sort={sort} onSort={handleSort} />
                      {showGuideCol && (
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">
                          {PARTNER_CONFIG.guide.label}
                        </th>
                      )}
                      {showTourVendorCol && (
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">
                          {PARTNER_CONFIG.tourVendor.label}
                        </th>
                      )}
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
                                // Awaiting a decision — kept at full strength, in
                                // orange. This movement is still expected to run,
                                // so greying it out like a dead file would be the
                                // wrong instruction to give the desk.
                                : isCancelPendingRow(row)
                                  ? 'bg-orange-50/60 border-l-2 border-l-orange-400 hover:bg-orange-50'
                                // Cancelled file — greyed and edged in rose so it
                                // cannot be mistaken for a movement to run.
                                : isCancelledRow(row)
                                  ? 'bg-rose-50/40 border-l-2 border-l-rose-400 text-slate-400 hover:bg-rose-50/70'
                                  // A stay, not a movement — tinted and edged so it
                                  // reads as a different kind of row at a glance.
                                  : row.isHotelOnlyBooking
                                    ? 'bg-amber-50/50 border-l-2 border-l-amber-400 hover:bg-amber-50'
                                    : 'hover:bg-slate-50/80',
                            )}
                          >
                            {/* Date — a stay spans nights, so it shows the span */}
                            <td className="px-3 py-2.5 whitespace-nowrap font-medium text-slate-800">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                {formatDate(row.date)}
                              </div>
                              {row.isHotelOnlyBooking && row.checkOut && (
                                <div className="mt-0.5 text-[10px] text-amber-700 font-semibold">
                                  → {formatDate(row.checkOut)}
                                  {row.nights ? ` · ${row.nights}N` : ''}
                                </div>
                              )}
                            </td>

                            {/* Booking Ref / IS / Agent ID */}
                            <td className="px-3 py-2.5">
                              <a href={`/dashboard/bookings/${row.vnCode}`} target="_blank" rel="noreferrer"
                                onClick={e => e.stopPropagation()}
                                className={cn(
                                  'font-mono font-semibold hover:underline whitespace-nowrap block',
                                  isCancelPendingRow(row) ? 'text-orange-800'
                                    : isCancelledRow(row) ? 'text-slate-500 line-through' : 'text-brand-700',
                                )}>
                                {q ? <Highlight text={row.vnCode} query={deepSearch} /> : row.vnCode}
                              </a>
                              {/* A pending request gets its own badge, carrying how
                                  long it has waited: "Cancelling" alone reads as a
                                  settled fact, and this one is a decision nobody
                                  has taken yet. */}
                              {isCancelPendingRow(row) ? (
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-0.5 mt-0.5 text-[10px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded whitespace-nowrap',
                                    waitTone(waitingDays(row.cancelRequestedAt)).chip,
                                  )}
                                  title={
                                    'Cancellation requested — awaiting the accounts team\'s approval. '
                                    + `${waitLabel(waitingDays(row.cancelRequestedAt))}`
                                    + (row.cancelRequestedBy ? `, raised by ${row.cancelRequestedBy}` : '')
                                    + '. The movement is still scheduled until the decision comes back. '
                                    + (row.cancelReason ? `Reason: ${row.cancelReason}` : 'No reason recorded.')
                                  }
                                >
                                  <Ban className="w-2.5 h-2.5" />
                                  Cancel Pending
                                  {waitingDays(row.cancelRequestedAt)
                                    ? ` · ${waitingDays(row.cancelRequestedAt)}d`
                                    : ''}
                                </span>
                              ) : isCancelledRow(row) && (
                                <span
                                  className="inline-flex items-center gap-0.5 mt-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800 bg-rose-100 border border-rose-300 px-1.5 py-0.5 rounded whitespace-nowrap"
                                  title={`This booking is ${row.bookingStatus?.replace(/_/g, ' ').toLowerCase()} — do not run this movement. It is excluded from the pax and service totals.`}
                                >
                                  Cancelled
                                </span>
                              )}
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

                            {/* Agent — who sold the file; operations reads it beside the ref */}
                            <td className="px-3 py-2.5 max-w-[140px]">
                              {row.agent ? (
                                <span className="block truncate font-medium text-slate-700" title={row.agent}>
                                  {q ? <Highlight text={row.agent} query={deepSearch} /> : row.agent}
                                </span>
                              ) : <span className="text-slate-300">—</span>}
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
                                  {to12h(row.meetingTime)}
                                </div>
                              ) : <span className="text-slate-300 text-[10px]">—</span>}
                            </td>

                            {/* Service Type */}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {/* The booking-level mark replaces the movement
                                    badges — on a stay row they would only repeat
                                    the same "no driver" point three times. */}
                                {row.isHotelOnlyBooking ? (
                                  <HotelOnlyBookingBadge />
                                ) : (
                                  <>
                                    <ServiceBadge type={row.serviceType} />
                                    {row.isLeisure && <LeisureBadge />}
                                    {row.isHotelOnly && <HotelOnlyBadge />}
                                  </>
                                )}
                              </div>
                            </td>

                            {/* Guide — assignable straight from the chart */}
                            {showGuideCol && (
                              <td className="px-3 py-2.5 text-slate-600 max-w-[150px]">
                                {isAssignable(row) ? (
                                  <PartnerCell
                                    kind="guide"
                                    name={row.guideName}
                                    phone={row.guidePhone}
                                    enabled={guideEnabledFor(row)}
                                    canAssign={canAssign}
                                    onAssign={() => setAssignRow(row)}
                                    query={deepSearch}
                                  />
                                ) : <span className="text-slate-300 text-[10px]">—</span>}
                              </td>
                            )}

                            {/* Tour Vendor */}
                            {showTourVendorCol && (
                              <td className="px-3 py-2.5 text-slate-600 max-w-[150px]">
                                {isAssignable(row) ? (
                                  <PartnerCell
                                    kind="tourVendor"
                                    name={row.tourVendorName}
                                    phone={row.tourVendorPhone}
                                    enabled={tourVendorEnabledFor(row)}
                                    canAssign={canAssign}
                                    onAssign={() => setAssignRow(row)}
                                    query={deepSearch}
                                  />
                                ) : <span className="text-slate-300 text-[10px]">—</span>}
                              </td>
                            )}

                            {/* Driver / Vendor */}
                            <td className="px-3 py-2.5 text-slate-600 max-w-[160px]">
                              {row.isHotelOnlyBooking ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 whitespace-nowrap"
                                  title="Hotel Only booking — no transport is sold on this file">
                                  <Hotel className="w-3 h-3 text-amber-600" />
                                  Accommodation only
                                </span>
                              ) : row.isHotelOnly ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-pink-700 whitespace-nowrap">
                                  <Hotel className="w-3 h-3 text-pink-500" />
                                  No driver needed
                                </span>
                              ) : row.isLeisure ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 whitespace-nowrap">
                                  <Palmtree className="w-3 h-3 text-amber-500" />
                                  No driver needed
                                </span>
                              ) : row.vendor || row.driverId || row.vendorId ? (
                                <div className="flex items-center gap-1 max-w-full">
                                <button
                                  onClick={e => { e.stopPropagation(); setDriverModalRow(row) }}
                                  className="flex items-center gap-1.5 min-w-0 rounded-full pl-1 pr-2.5 py-1 -ml-1 hover:bg-brand-50 hover:ring-1 hover:ring-brand-200 transition-colors group"
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
                                {/* Viewing and re-assigning are different jobs,
                                    so they are different buttons — clicking the
                                    driver still opens their details. */}
                                {canAssign && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setAssignRow(row) }}
                                    title="Re-assign this movement"
                                    className="flex-shrink-0 p-1 rounded text-slate-300 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                  >
                                    <UserPlus className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                </div>
                              ) : canAssign ? (
                                <button
                                  onClick={e => { e.stopPropagation(); setAssignRow(row) }}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-brand-700 rounded px-1.5 py-0.5 hover:bg-brand-50 transition-colors"
                                >
                                  <UserPlus className="w-3 h-3" /> Assign
                                </button>
                              ) : <span className="text-slate-300 text-[10px]">—</span>}
                            </td>
                          </tr>

                          {/* Expanded detail row */}
                          {isExpanded && (
                            <tr key={`${row.id}-detail`} className="bg-brand-50/40 border-l-2 border-l-brand-400">
                              <td colSpan={13 + (showGuideCol ? 1 : 0) + (showTourVendorCol ? 1 : 0)} className="px-4 py-3">
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
                                    { label: PARTNER_CONFIG.guide.label,      value: row.guideName },
                                    { label: 'Guide Phone',                   value: row.guidePhone },
                                    { label: PARTNER_CONFIG.tourVendor.label, value: row.tourVendorName },
                                    { label: 'Tour Vendor Phone',             value: row.tourVendorPhone },
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

                                {/* The request in full, for the row somebody opened
                                    because of the badge on it. */}
                                {isCancelPendingRow(row) && (
                                  <div className={cn(
                                    'mt-3 rounded-xl border p-3',
                                    waitTone(waitingDays(row.cancelRequestedAt)).border,
                                    'bg-orange-50/70',
                                  )}>
                                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-800">
                                      <Ban className="w-3 h-3" />
                                      Cancellation requested — awaiting accounts approval
                                    </p>
                                    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-slate-600 sm:grid-cols-4">
                                      <div>
                                        <span className="text-slate-400">Requested on:</span>{' '}
                                        {row.cancelRequestedAt ? formatDate(row.cancelRequestedAt.slice(0, 10)) : '—'}
                                      </div>
                                      <div><span className="text-slate-400">Requested by:</span> {row.cancelRequestedBy || '—'}</div>
                                      <div>
                                        <span className="text-slate-400">Waiting:</span>{' '}
                                        <span className={cn('font-semibold', waitTone(waitingDays(row.cancelRequestedAt)).text)}>
                                          {waitLabel(waitingDays(row.cancelRequestedAt))}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400">Cancellation fee:</span>{' '}
                                        {row.cancelFeeTotal != null
                                          ? formatCurrency(row.cancelFeeTotal, row.currency ?? 'USD')
                                          : '—'}
                                      </div>
                                    </div>
                                    <p className="mt-2 whitespace-pre-wrap text-[11px] text-slate-700">
                                      <span className="text-slate-400">Reason: </span>
                                      {row.cancelReason || 'No reason recorded.'}
                                    </p>
                                    <p className="mt-2 text-[10px] font-semibold text-orange-800">
                                      This movement is still scheduled. Do not stand the driver down until the
                                      accounts team approves the cancellation.
                                    </p>
                                  </div>
                                )}

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

      {/* Assigning from the chart itself — the same dialog the booking's
          movement chart uses, so the save, the allocation-board sync and the
          driver's WhatsApp all behave identically. */}
      {assignRow && (
        <AssignMovementModal
          open
          onClose={() => setAssignRow(null)}
          bookingRef={assignRow.vnCode}
          agendaItemId={assignRow.id}
          date={assignRow.date}
          country={assignRow.operationCountry}
          assignment={{
            driverId:        assignRow.driverId,
            vendorId:        assignRow.vendorId,
            vendorName:      assignRow.vendorName,
            driverName:      assignRow.driverName,
            driverPhone:     assignRow.driverPhone,
            vehicleType:     assignRow.vehicleType,
            vehiclePlate:    assignRow.vehiclePlate,
            driverRate:      assignRow.driverRate,
            rateCurrency:    assignRow.rateCurrency,
            guideId:         assignRow.guideId,
            guideName:       assignRow.guideName,
            guidePhone:      assignRow.guidePhone,
            tourVendorId:    assignRow.tourVendorId,
            tourVendorName:  assignRow.tourVendorName,
            tourVendorPhone: assignRow.tourVendorPhone,
          }}
          onSaved={next => applyAssignment(assignRow.id, next)}
        />
      )}
    </div>
  )
}
