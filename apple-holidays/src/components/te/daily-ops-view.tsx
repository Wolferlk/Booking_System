'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import {
  Plane, Hotel, Users, Calendar, ChevronLeft, ChevronRight,
  Loader2, MapPin, ArrowRight, RefreshCw, Car,
  LogIn, LogOut, Utensils, Navigation, Phone, Compass,
  CheckCircle2, Sun, Bed, Printer, X, Search,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgendaItem {
  id: string
  date: string
  location: string
  fromPoint: string | null
  toPoint: string | null
  details: string | null
  mealPlan: string | null
  meetingTime: string | null
  serviceType: 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT'
}

interface Flight {
  id: string
  flightNo: string
  date: string
  fromApt: string
  depTime: string
  toApt: string
  arrTime: string
  airline: string | null
}

interface Accommodation {
  id: string
  hotel: string
  city: string
  checkIn: string
  checkOut: string
  roomType: string | null
  mealType: string | null
  nights: number
}

interface Passenger {
  id: string
  name: string
  type: string
  isLead: boolean
}

interface EmergencyContact {
  id: string
  name: string
  phone: string | null
  role: string | null
}

interface DailyBooking {
  id: string
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  status: string
  paxAdults: number
  paxChildren: number
  arrivalDate: string
  departureDate: string
  passengers: Passenger[]
  emergencyContacts: EmergencyContact[]
  agendaItems: AgendaItem[]
  flights: Flight[]
  checkIns: Accommodation[]
  checkOuts: Accommodation[]
  stayingAt: Accommodation | null
  isArriving: boolean
  isDeparting: boolean
  hasActivity: boolean
}

interface DailySummary {
  totalActive: number
  withActivity: number
  totalFlights: number
  totalAgendaItems: number
  totalCheckIns: number
  totalCheckOuts: number
  totalArrivals: number
  totalDepartures: number
}

interface DayData {
  date: string
  bookings: DailyBooking[]
  summary: DailySummary
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toYMD(d: Date) {
  return d.toISOString().slice(0, 10)
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return toYMD(d)
}

function formatDisplayDate(ymd: string): string {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtShort(ymd: string): string {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function matchesSearch(b: DailyBooking, q: string): boolean {
  if (!q) return true
  const lq = q.toLowerCase()
  return (
    b.bookingRef.toLowerCase().includes(lq) ||
    (b.agent ?? '').toLowerCase().includes(lq) ||
    (b.fileHandler ?? '').toLowerCase().includes(lq) ||
    b.passengers.some(p => p.name.toLowerCase().includes(lq)) ||
    (b.stayingAt?.hotel ?? '').toLowerCase().includes(lq) ||
    b.checkIns.some(a => a.hotel.toLowerCase().includes(lq)) ||
    b.checkOuts.some(a => a.hotel.toLowerCase().includes(lq))
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const SERVICE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; chip: string; label: string }> = {
  PVT_TRANSFER:    { icon: Car,       chip: 'bg-blue-100 text-blue-700',   label: 'PVT' },
  SIC_TRANSFER:    { icon: Users,     chip: 'bg-orange-100 text-orange-700', label: 'SIC' },
  OWN_ARRANGEMENT: { icon: Compass,   chip: 'bg-slate-100 text-slate-600',  label: 'OWN' },
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const cfg = SERVICE_CONFIG[item.serviceType] ?? SERVICE_CONFIG.OWN_ARRANGEMENT
  const Icon = cfg.icon
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <div className="w-12 flex-shrink-0 text-right">
        {item.meetingTime ? (
          <span className="text-xs font-bold text-brand-600 font-mono">{item.meetingTime}</span>
        ) : (
          <span className="text-[10px] text-slate-300 font-mono">—</span>
        )}
      </div>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.chip}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.fromPoint && item.toPoint ? (
            <span className="text-sm font-medium text-slate-800">
              {item.fromPoint} <ArrowRight className="w-3 h-3 inline text-slate-400" /> {item.toPoint}
            </span>
          ) : (
            <span className="text-sm font-medium text-slate-800">{item.location}</span>
          )}
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${cfg.chip}`}>
            {cfg.label}
          </span>
          {item.mealPlan && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">
              <Utensils className="w-2.5 h-2.5" /> {item.mealPlan}
            </span>
          )}
        </div>
        {item.details && (
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-2">{item.details}</p>
        )}
      </div>
    </div>
  )
}

function FlightRow({ flight }: { flight: Flight }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
        <Plane className="w-3.5 h-3.5 text-indigo-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold font-mono text-sm text-slate-900">{flight.flightNo}</span>
          {flight.airline && <span className="text-xs text-slate-500">{flight.airline}</span>}
        </div>
        <p className="text-xs text-slate-600 font-medium">
          {flight.fromApt}
          {flight.depTime ? ` ${flight.depTime}` : ''}
          {' '}<ArrowRight className="w-3 h-3 inline text-slate-400" />{' '}
          {flight.toApt}
          {flight.arrTime ? ` ${flight.arrTime}` : ''}
        </p>
      </div>
    </div>
  )
}

function HotelChip({ hotel, city, roomType, mealType, mode }: {
  hotel: string; city: string; roomType?: string | null; mealType?: string | null; mode: 'checkin' | 'checkout' | 'staying'
}) {
  const config = {
    checkin:  { icon: LogIn,  bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: 'CHECK-IN' },
    checkout: { icon: LogOut, bg: 'bg-rose-50 border-rose-200',       text: 'text-rose-700',    label: 'CHECK-OUT' },
    staying:  { icon: Bed,    bg: 'bg-blue-50 border-blue-200',       text: 'text-blue-700',    label: 'STAYING' },
  }[mode]
  const Icon = config.icon
  return (
    <div className={`flex items-start gap-2 p-2.5 rounded-lg border ${config.bg}`}>
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${config.text}`} />
      <div className="min-w-0">
        <p className={`text-[9px] font-bold uppercase tracking-wide ${config.text}`}>{config.label}</p>
        <p className="text-sm font-semibold text-slate-800 leading-tight truncate">{hotel}</p>
        <p className="text-xs text-slate-500 flex items-center gap-1">
          <MapPin className="w-2.5 h-2.5 flex-shrink-0" /> {city}
        </p>
        {roomType && <p className="text-[10px] text-slate-400">{roomType}</p>}
        {mealType && <p className="text-[10px] text-slate-400">{mealType}</p>}
      </div>
    </div>
  )
}

// ─── Booking day card ─────────────────────────────────────────────────────────

function BookingDayCard({ booking }: { booking: DailyBooking }) {
  const lead     = booking.passengers.find(p => p.isLead) ?? booking.passengers[0]

  return (
    <Card className="overflow-hidden">

      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 bg-white">
        <div className="flex items-center gap-2.5 flex-wrap min-w-0">
          <Link
            href={`/dashboard/bookings/${booking.bookingRef}`}
            className="text-base font-bold font-mono text-slate-900 hover:text-brand-600 transition-colors"
          >
            {booking.bookingRef}
          </Link>
          <StatusBadge status={booking.status as Parameters<typeof StatusBadge>[0]['status']} />
          {booking.isArriving && (
            <span className="inline-flex items-center gap-1 text-xs bg-brand-500 text-white px-2 py-0.5 rounded-full font-semibold">
              <LogIn className="w-3 h-3" /> Arriving
            </span>
          )}
          {booking.isDeparting && (
            <span className="inline-flex items-center gap-1 text-xs bg-rose-500 text-white px-2 py-0.5 rounded-full font-semibold">
              <LogOut className="w-3 h-3" /> Departing
            </span>
          )}
        </div>
        <Link
          href={`/dashboard/bookings/${booking.bookingRef}`}
          className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium flex-shrink-0"
        >
          View <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Agent / pax / handler row */}
      <div className="px-5 pb-3 flex items-center gap-4 text-xs text-slate-500 flex-wrap">
        {booking.agent && (
          <span className="flex items-center gap-1">
            <Navigation className="w-3 h-3" /> {booking.agent}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          {booking.paxAdults}A{booking.paxChildren > 0 ? ` ${booking.paxChildren}C` : ''}
          {lead ? ` · ${lead.name}` : ''}
        </span>
        {booking.fileHandler && (
          <span className="text-slate-400">Handler: {booking.fileHandler}</span>
        )}
        {booking.emergencyContacts.length > 0 && (
          <span className="flex items-center gap-1 text-slate-400">
            <Phone className="w-3 h-3" /> {booking.emergencyContacts[0].name}
            {booking.emergencyContacts[0].phone && ` · ${booking.emergencyContacts[0].phone}`}
          </span>
        )}
      </div>

      {/* Activity sections */}
      <div className="border-t border-slate-100">

        {booking.agendaItems.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Calendar className="w-3 h-3" /> Movement Chart
              <span className="ml-1 bg-slate-100 text-slate-500 text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                {booking.agendaItems.length}
              </span>
            </p>
            <div>
              {booking.agendaItems.map(item => <AgendaRow key={item.id} item={item} />)}
            </div>
          </div>
        )}

        {booking.flights.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Plane className="w-3 h-3" /> Flights Today
              <span className="ml-1 bg-indigo-100 text-indigo-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                {booking.flights.length}
              </span>
            </p>
            <div>
              {booking.flights.map(f => <FlightRow key={f.id} flight={f} />)}
            </div>
          </div>
        )}

        {(booking.checkIns.length > 0 || booking.checkOuts.length > 0 || booking.stayingAt) && (
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Hotel className="w-3 h-3" /> Accommodation
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {booking.checkIns.map(a => (
                <HotelChip key={a.id} hotel={a.hotel} city={a.city} roomType={a.roomType} mealType={a.mealType} mode="checkin" />
              ))}
              {booking.checkOuts.map(a => (
                <HotelChip key={a.id} hotel={a.hotel} city={a.city} roomType={a.roomType} mealType={a.mealType} mode="checkout" />
              ))}
              {booking.stayingAt &&
                !booking.checkIns.find(a => a.id === booking.stayingAt!.id) &&
                !booking.checkOuts.find(a => a.id === booking.stayingAt!.id) && (
                <HotelChip
                  key={booking.stayingAt.id}
                  hotel={booking.stayingAt.hotel}
                  city={booking.stayingAt.city}
                  roomType={booking.stayingAt.roomType}
                  mealType={booking.stayingAt.mealType}
                  mode="staying"
                />
              )}
            </div>
          </div>
        )}

        {!booking.hasActivity && (
          <div className="px-5 py-3 text-xs text-slate-400 flex items-center gap-2">
            <Sun className="w-3.5 h-3.5 text-amber-400" />
            Trip in progress — no scheduled activities today
            {booking.stayingAt && (
              <span className="ml-2 flex items-center gap-1 text-slate-500">
                <Hotel className="w-3 h-3" /> {booking.stayingAt.hotel}, {booking.stayingAt.city}
              </span>
            )}
          </div>
        )}

      </div>
    </Card>
  )
}

// ─── Day section (range mode) ─────────────────────────────────────────────────

function DaySection({ day }: { day: DayData }) {
  const [showInactive, setShowInactive] = useState(false)
  const active   = day.bookings.filter(b => b.hasActivity)
  const inactive = day.bookings.filter(b => !b.hasActivity)

  return (
    <div className="space-y-3">

      {/* Day header bar */}
      <div className="flex items-center gap-3 flex-wrap py-2 border-b-2 border-brand-200">
        <span className="font-bold text-slate-800 text-sm">{formatDisplayDate(day.date)}</span>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-semibold">
            {day.summary.totalActive} active
          </span>
          {day.summary.withActivity > 0 && (
            <span className="bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full font-semibold">
              {day.summary.withActivity} w/ activity
            </span>
          )}
          {day.summary.totalFlights > 0 && (
            <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-semibold">
              {day.summary.totalFlights} flights
            </span>
          )}
          {day.summary.totalArrivals > 0 && (
            <span className="bg-teal-50 text-teal-600 px-2 py-0.5 rounded-full font-semibold">
              {day.summary.totalArrivals} arrivals
            </span>
          )}
          {day.summary.totalDepartures > 0 && (
            <span className="bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full font-semibold">
              {day.summary.totalDepartures} departures
            </span>
          )}
        </div>
        <Link
          href={`/print/te/daily?date=${day.date}`}
          target="_blank"
          className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200 transition-colors"
        >
          <Printer className="w-3 h-3" /> Print Day
        </Link>
      </div>

      {day.bookings.length === 0 && (
        <p className="text-xs text-slate-400 py-4 text-center">No active bookings this day</p>
      )}

      {active.map(b => <BookingDayCard key={b.id} booking={b} />)}

      {inactive.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowInactive(v => !v)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            <Sun className="w-3.5 h-3.5 text-amber-400" />
            {inactive.length} trip{inactive.length !== 1 ? 's' : ''} in-progress, no activity
            <ChevronRight className={`w-3 h-3 transition-transform ${showInactive ? 'rotate-90' : ''}`} />
          </button>
          {showInactive && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {inactive.map(b => {
                const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
                return (
                  <Link
                    key={b.id}
                    href={`/dashboard/bookings/${b.bookingRef}`}
                    className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <Users className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold font-mono text-slate-800">{b.bookingRef}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {lead?.name ?? b.agent ?? '—'}
                        {b.stayingAt ? ` · ${b.stayingAt.hotel}` : ''}
                      </p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto flex-shrink-0" />
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type FilterKey = 'all' | 'activity' | 'agenda' | 'flights' | 'checkins' | 'checkouts' | 'arrivals' | 'departures'
type ViewMode  = 'single' | 'range'

export default function DailyOpsView() {
  const todayYMD = toYMD(new Date())

  // ── Single-day state ────────────────────────────────────────────────────────
  const [date, setDate]               = useState(todayYMD)
  const [bookings, setBookings]       = useState<DailyBooking[]>([])
  const [summary, setSummary]         = useState<DailySummary | null>(null)
  const [loading, setLoading]         = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [filter, setFilter]           = useState<FilterKey>('all')

  // ── Range state ─────────────────────────────────────────────────────────────
  const [viewMode, setViewMode]           = useState<ViewMode>('single')
  const [rangeFrom, setRangeFrom]         = useState(todayYMD)
  const [rangeTo, setRangeTo]             = useState(offsetDate(todayYMD, 6))
  const [appliedRange, setAppliedRange]   = useState<{ from: string; to: string } | null>(null)
  const [rangeData, setRangeData]         = useState<DayData[]>([])
  const [rangeLoading, setRangeLoading]   = useState(false)

  // ── Search ──────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')

  // ── Single-day load ─────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res  = await fetch(`/api/te/daily?date=${date}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setBookings(json.data.bookings)
      setSummary(json.data.summary)
    } catch (err: unknown) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load(); setFilter('all') }, [load])

  // Auto-refresh every 3 minutes (single mode)
  useEffect(() => {
    const id = setInterval(() => load(true), 180_000)
    return () => clearInterval(id)
  }, [load])

  // ── Range load ──────────────────────────────────────────────────────────────
  const loadRange = useCallback(async () => {
    if (!appliedRange) return
    setRangeLoading(true)
    try {
      const res  = await fetch(`/api/te/daily-range?from=${appliedRange.from}&to=${appliedRange.to}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setRangeData(json.data.days)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load range data')
    } finally {
      setRangeLoading(false)
    }
  }, [appliedRange])

  useEffect(() => { loadRange() }, [loadRange])

  // ── Filtered bookings (single mode, stat-card filter then search) ───────────
  const filteredBookings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let list: DailyBooking[]
    switch (filter) {
      case 'activity':    list = bookings.filter(b => b.hasActivity); break
      case 'agenda':      list = bookings.filter(b => b.agendaItems.length > 0); break
      case 'flights':     list = bookings.filter(b => b.flights.length > 0); break
      case 'checkins':    list = bookings.filter(b => b.checkIns.length > 0); break
      case 'checkouts':   list = bookings.filter(b => b.checkOuts.length > 0); break
      case 'arrivals':    list = bookings.filter(b => b.isArriving); break
      case 'departures':  list = bookings.filter(b => b.isDeparting); break
      default:            list = bookings
    }
    return q ? list.filter(b => matchesSearch(b, q)) : list
  }, [bookings, filter, searchQuery])

  // ── Filtered range data (search applied per day) ─────────────────────────────
  const filteredRangeData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rangeData
    return rangeData.map(day => ({
      ...day,
      bookings: day.bookings.filter(b => matchesSearch(b, q)),
    }))
  }, [rangeData, searchQuery])

  const active   = filteredBookings.filter(b => b.hasActivity)
  const inactive = filteredBookings.filter(b => !b.hasActivity)
  const isToday  = date === todayYMD

  const quickDays: { label: string; offset: number }[] = [
    { label: '-7 Days',   offset: -7 },
    { label: '-3 Days',   offset: -3 },
    { label: 'Yesterday', offset: -1 },
    { label: 'Today',     offset:  0 },
    { label: 'Tomorrow',  offset:  1 },
  ]

  const rangeAppliedDays = appliedRange
    ? Math.ceil((new Date(appliedRange.to).getTime() - new Date(appliedRange.from).getTime()) / 86_400_000) + 1
    : 0

  return (
    <div className="space-y-5">

      {/* ── Date selector card ── */}
      <Card className="p-4">

        {/* View mode toggle */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 mb-4 w-fit">
          {(['single', 'range'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                viewMode === mode
                  ? 'bg-white shadow-sm text-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {mode === 'single' ? 'Single Day' : 'Date Range'}
            </button>
          ))}
        </div>

        {/* Single-day controls */}
        {viewMode === 'single' && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDate(d => offsetDate(d, -1))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setDate(d => offsetDate(d, 1))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {quickDays.map(q => {
                const target   = offsetDate(todayYMD, q.offset)
                const isActive = date === target
                return (
                  <button
                    key={q.offset}
                    onClick={() => setDate(target)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      isActive
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : q.offset === 0
                          ? 'bg-brand-50 text-brand-600 border-brand-200 hover:bg-brand-100'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {q.label}
                  </button>
                )
              })}
            </div>

            <input
              type="date"
              value={date}
              onChange={e => e.target.value && setDate(e.target.value)}
              className="form-input text-sm py-1.5 w-full sm:w-40"
            />

            <button
              onClick={() => load(false)}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors ml-auto"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {/* Range controls */}
        {viewMode === 'range' && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500 font-medium">From</span>
                <input
                  type="date"
                  value={rangeFrom}
                  onChange={e => e.target.value && setRangeFrom(e.target.value)}
                  className="form-input text-sm py-1.5 w-36"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500 font-medium">To</span>
                <input
                  type="date"
                  value={rangeTo}
                  onChange={e => e.target.value && setRangeTo(e.target.value)}
                  className="form-input text-sm py-1.5 w-36"
                />
              </div>
              <button
                onClick={() => {
                  if (rangeFrom > rangeTo) { toast.error('From date must be before To date'); return }
                  setAppliedRange({ from: rangeFrom, to: rangeTo })
                }}
                disabled={rangeLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-60 transition-colors"
              >
                {rangeLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Apply
              </button>
            </div>
            <Link
              href={appliedRange ? `/print/te/daily?from=${appliedRange.from}&to=${appliedRange.to}` : '#'}
              target="_blank"
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-900 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Print Range
            </Link>
          </div>
        )}

        {/* Date label */}
        {viewMode === 'single' && (
          <div className="mt-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-brand-500" />
            <span className="font-semibold text-slate-800 text-sm">{formatDisplayDate(date)}</span>
            {isToday && (
              <span className="text-xs bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full font-semibold">Today</span>
            )}
          </div>
        )}

        {viewMode === 'range' && appliedRange && (
          <div className="mt-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-brand-500" />
            <span className="font-semibold text-slate-800 text-sm">
              {fmtShort(appliedRange.from)} — {fmtShort(appliedRange.to)}
            </span>
            <span className="text-xs text-slate-400">({rangeAppliedDays} day{rangeAppliedDays !== 1 ? 's' : ''})</span>
          </div>
        )}

        {/* Search bar */}
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search booking ref, agent, passenger name, hotel…"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-slate-200 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-[11px] text-slate-400 mt-1.5">
              {viewMode === 'single'
                ? `${filteredBookings.length} booking${filteredBookings.length !== 1 ? 's' : ''} match`
                : `${filteredRangeData.reduce((s, d) => s + d.bookings.length, 0)} booking${filteredRangeData.reduce((s, d) => s + d.bookings.length, 0) !== 1 ? 's' : ''} match across ${filteredRangeData.length} day${filteredRangeData.length !== 1 ? 's' : ''}`
              }
            </p>
          )}
        </div>
      </Card>

      {/* ─── SINGLE DAY MODE ─────────────────────────────────────────────────── */}
      {viewMode === 'single' && (
        <>
          {/* Summary stats (clickable filters) */}
          {!loading && summary && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {([
                  { key: 'all' as FilterKey,        label: 'Active Trips',   value: summary.totalActive,      icon: <CheckCircle2 className="w-4 h-4" />,  color: 'text-brand-600',   bg: 'bg-brand-50',   ring: 'ring-brand-400' },
                  { key: 'activity' as FilterKey,   label: 'With Activity',  value: summary.withActivity,     icon: <Calendar className="w-4 h-4" />,      color: 'text-violet-600',  bg: 'bg-violet-50',  ring: 'ring-violet-400' },
                  { key: 'agenda' as FilterKey,     label: 'Agenda Items',   value: summary.totalAgendaItems, icon: <Navigation className="w-4 h-4" />,    color: 'text-blue-600',    bg: 'bg-blue-50',    ring: 'ring-blue-400' },
                  { key: 'flights' as FilterKey,    label: 'Flights',        value: summary.totalFlights,     icon: <Plane className="w-4 h-4" />,         color: 'text-indigo-600',  bg: 'bg-indigo-50',  ring: 'ring-indigo-400' },
                  { key: 'checkins' as FilterKey,   label: 'Check-ins',      value: summary.totalCheckIns,    icon: <LogIn className="w-4 h-4" />,         color: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-400' },
                  { key: 'checkouts' as FilterKey,  label: 'Check-outs',     value: summary.totalCheckOuts,   icon: <LogOut className="w-4 h-4" />,        color: 'text-rose-600',    bg: 'bg-rose-50',    ring: 'ring-rose-400' },
                  { key: 'arrivals' as FilterKey,   label: 'Arrivals',       value: summary.totalArrivals,    icon: <LogIn className="w-4 h-4" />,         color: 'text-teal-600',    bg: 'bg-teal-50',    ring: 'ring-teal-400' },
                  { key: 'departures' as FilterKey, label: 'Departures',     value: summary.totalDepartures,  icon: <LogOut className="w-4 h-4" />,        color: 'text-orange-600',  bg: 'bg-orange-50',  ring: 'ring-orange-400' },
                ] as const).map(s => (
                  <button
                    key={s.key}
                    onClick={() => setFilter(prev => prev === s.key ? 'all' : s.key)}
                    className={`${s.bg} rounded-xl p-3 flex flex-col gap-1 text-left transition-all hover:shadow-sm ${
                      filter === s.key ? `ring-2 ${s.ring} shadow-sm` : 'ring-1 ring-transparent'
                    }`}
                  >
                    <div className={s.color}>{s.icon}</div>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-slate-500 font-medium leading-tight">{s.label}</p>
                  </button>
                ))}
              </div>

              {/* Filter pill + Print button */}
              <div className="flex items-center gap-2">
                {filter !== 'all' && (
                  <div className="flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-lg px-3 py-1.5 text-xs text-brand-700 font-medium">
                    <span>Showing: <strong>{filter}</strong> ({filteredBookings.length} booking{filteredBookings.length !== 1 ? 's' : ''})</span>
                    <button onClick={() => setFilter('all')} className="text-brand-400 hover:text-brand-700">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <Link
                  href={`/print/te/daily?date=${date}`}
                  target="_blank"
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-900 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / Export PDF
                </Link>
              </div>
            </>
          )}

          {loading && (
            <div className="flex items-center justify-center py-24 gap-3">
              <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
              <span className="text-slate-500 text-sm">Loading daily operations…</span>
            </div>
          )}

          {!loading && filteredBookings.length === 0 && (
            <Card className="p-16 text-center">
              <Sun className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="font-semibold text-slate-400">
                {searchQuery ? `No bookings match "${searchQuery}"` : 'No active bookings on this day'}
              </p>
              {!searchQuery && (
                <p className="text-sm text-slate-300 mt-1">Try a different date or check Live Overview for upcoming arrivals</p>
              )}
            </Card>
          )}

          {!loading && active.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-700">Bookings with Activity</h2>
                <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-bold">{active.length}</span>
              </div>
              {active.map(b => <BookingDayCard key={b.id} booking={b} />)}
            </div>
          )}

          {!loading && inactive.length > 0 && (
            <div className="space-y-2">
              <button
                onClick={() => setShowInactive(v => !v)}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-600 transition-colors"
              >
                <Sun className="w-4 h-4 text-amber-400" />
                <span className="font-medium">
                  {inactive.length} trip{inactive.length !== 1 ? 's' : ''} in-progress with no scheduled activity today
                </span>
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showInactive ? 'rotate-90' : ''}`} />
              </button>

              {showInactive && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {inactive.map(b => {
                    const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
                    return (
                      <Link
                        key={b.id}
                        href={`/dashboard/bookings/${b.bookingRef}`}
                        className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Users className="w-4 h-4 text-slate-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold font-mono text-slate-800">{b.bookingRef}</p>
                          <p className="text-xs text-slate-500 truncate">
                            {lead?.name ?? b.agent ?? '—'}
                            {b.stayingAt ? ` · ${b.stayingAt.hotel}` : ''}
                          </p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto flex-shrink-0" />
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── RANGE MODE ──────────────────────────────────────────────────────── */}
      {viewMode === 'range' && (
        <>
          {rangeLoading && (
            <div className="flex items-center justify-center py-24 gap-3">
              <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
              <span className="text-slate-500 text-sm">Loading range operations…</span>
            </div>
          )}

          {!rangeLoading && !appliedRange && (
            <Card className="p-16 text-center">
              <Calendar className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="font-semibold text-slate-400">Select a date range and click Apply</p>
              <p className="text-sm text-slate-300 mt-1">View all operations across up to 31 days at once</p>
            </Card>
          )}

          {!rangeLoading && appliedRange && filteredRangeData.every(d => d.bookings.length === 0) && (
            <Card className="p-16 text-center">
              <Sun className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="font-semibold text-slate-400">
                {searchQuery ? `No bookings match "${searchQuery}"` : 'No active bookings in this period'}
              </p>
            </Card>
          )}

          {!rangeLoading && appliedRange && filteredRangeData.map(day => (
            <DaySection key={day.date} day={day} />
          ))}
        </>
      )}

    </div>
  )
}
