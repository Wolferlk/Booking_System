'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Car, Truck, Search, X, ChevronDown, CheckCircle2, AlertTriangle,
  CalendarDays, Clock, Plane, User2, Phone, Users,
  FileText, RefreshCw, Loader2, Edit2, UserCheck,
  Navigation2, Building2, Route, Shield, Info, ChevronRight,
  ArrowRight, ArrowUpDown, ArrowUp, ArrowDown, Filter, SlidersHorizontal,
  Eye, EyeOff, Palmtree,
  Wallet, Banknote, Calculator, PencilLine, History, ShieldCheck, MinusCircle,
} from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'
import { cn } from '@/lib/utils'
import {
  HOTEL_ONLY_VEHICLE, bookingNeedsDriver, movementNeedsDriver, resolveIsHotelOnly,
} from '@/lib/driver-requirement'
import {
  CATEGORY_TONE, STAGE_TONE, lkr, money,
  type DriverAdvanceCategory, type DriverAdvanceDetail, type DriverAdvanceSummary,
} from '@/lib/driver-advance'

// ── Types ─────────────────────────────────────────────────────────────────────

type VehicleType = 'car' | 'flat_roof' | 'high_roof' | 'bus' | 'hotel_only'
type AllocStatus = 'assigned' | 'vendor' | 'hotel_only' | 'pending' | 'emergency'
type SortField   = 'arrivalDate' | 'departureDate' | 'createdAt' | 'agent' | 'isNumber' | 'pendingFirst'
type SortDir     = 'asc' | 'desc'
type DateField   = 'arrivalDate' | 'departureDate' | 'createdAt'

interface LeadPassenger { name: string; contact: string | null }
interface FlightInfo {
  id: string; flightNo: string; date: string; fromApt: string
  depTime: string; toApt: string; arrTime: string; airline: string | null
}
interface AccomInfo {
  id: string; hotel: string; city: string; checkIn: string; checkOut: string
  nights: number; roomType: string | null; mealType: string | null
}
interface ItinDay  { id: string; dayNo: number; date: string; title: string; description: string | null }
interface MovementItem {
  id: string; date: string; location: string; fromPoint: string | null; toPoint: string | null
  details: string | null; timeFrom: string | null; timeTo: string | null; serviceType: string
  /** No driver needed for this movement — a free day, or hotel only. */
  isLeisure: boolean | null; isHotelOnly: boolean | null
  assignment: {
    driverName: string | null; driverPhone: string | null; vendorName: string | null
    vehicleType: string | null; vehiclePlate: string | null
    driver: { id: string; name: string; phone: string } | null
    vendor: { id: string; name: string; phone: string | null } | null
  } | null
}
interface DriverInfo {
  id: string; name: string; phone: string; isActive: boolean; photoUrl: string | null
  country: string | null
  vehicle: { id: string; type: string; plateNo: string; brand: string | null; model: string | null } | null
}
interface VendorInfo { id: string; name: string; phone: string | null; isActive: boolean }
interface SLAllocation {
  id: string; vehicleType: string | null; driverId: string | null; vendorId: string | null
  notes: string | null; isEmergency: boolean; changeReason: string | null; changedAt: string | null
  driver: DriverInfo | null; vendor: VendorInfo | null
}
interface SLBooking {
  id: string; bookingRef: string; isNumber: string | null; cntlNumber: string | null
  agent: string | null; agentPhone: string | null; fileHandler: string | null
  arrivalDate: string; departureDate: string; createdAt: string; status: string
  paxAdults: number; paxChildren: number
  contactPhone: string | null; contactEmail: string | null
  tourDestination: string | null; importantNotes: string | null
  passengers: LeadPassenger[]
  flights: FlightInfo[]
  accommodations: AccomInfo[]
  itineraryItems: ItinDay[]
  tourAgenda: { items: MovementItem[] } | null
  slDriverAllocation: SLAllocation | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VEHICLE_OPTIONS: { value: VehicleType; label: string; icon: string; color: string }[] = [
  { value: 'car',        label: 'Car',        icon: '🚗', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { value: 'flat_roof',  label: 'Flat Roof',  icon: '🚙', color: 'text-teal-400 bg-teal-500/10 border-teal-500/30' },
  { value: 'high_roof',  label: 'High Roof',  icon: '🚐', color: 'text-violet-400 bg-violet-500/10 border-violet-500/30' },
  { value: 'bus',        label: 'Bus',        icon: '🚌', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { value: 'hotel_only', label: 'Hotel Only', icon: '🏨', color: 'text-pink-400 bg-pink-500/10 border-pink-500/30' },
]

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'arrivalDate',   label: 'Arrival Date' },
  { value: 'departureDate', label: 'Departure Date' },
  { value: 'createdAt',     label: 'Created Date' },
  { value: 'agent',         label: 'Agent Name' },
  { value: 'isNumber',      label: 'IS Number' },
  { value: 'pendingFirst',  label: 'Pending First' },
]

const DATE_FIELD_OPTIONS: { value: DateField; label: string }[] = [
  { value: 'arrivalDate',   label: 'Arrival Date' },
  { value: 'departureDate', label: 'Departure Date' },
  { value: 'createdAt',     label: 'Created Date' },
]

const STATUS_OPTIONS = [
  { value: 'all',        label: 'All',        short: 'All' },
  { value: 'assigned',   label: 'Driver',     short: 'Driver' },
  { value: 'vendor',     label: 'Vendor',     short: 'Vendor' },
  { value: 'hotel_only', label: 'Hotel Only', short: '🏨 Hotel Only' },
  { value: 'pending',    label: 'Pending',    short: 'Pending' },
  { value: 'emergency',  label: 'Emergency',  short: '⚠ Emergency' },
]

const STATUS_BADGE: Record<string, string> = {
  assigned:   'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
  vendor:     'bg-blue-500/15 border-blue-500/30 text-blue-400',
  hotel_only: 'bg-pink-500/15 border-pink-500/30 text-pink-400',
  pending:    'bg-slate-700/50 border-slate-600/30 text-slate-400',
  emergency:  'bg-red-500/15 border-red-500/30 text-red-400',
}

const STATUS_LABEL: Record<string, string> = {
  assigned:   'Driver',
  vendor:     'Vendor',
  hotel_only: 'Hotel Only',
  pending:    'Pending',
  emergency:  'Emergency',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function vehicleMeta(v: string | null | undefined) {
  return VEHICLE_OPTIONS.find(o => o.value === v) ?? null
}

/** Who is actually driving this file — the allocation row, or failing that the
 *  Movement Chart. A driver named on the chart without a driver/vendor record
 *  (a vendor's own man, typed in by hand) has nowhere to live on the allocation
 *  row, so the chart stays the fallback source rather than reading as pending. */
interface EffectiveDriver {
  kind: 'driver' | 'vendor'
  name: string
  phone: string | null
  plate: string | null
  fromAgenda: boolean
}

function effectiveDriver(b: SLBooking): EffectiveDriver | null {
  const a = b.slDriverAllocation
  if (a?.driver) {
    return { kind: 'driver', name: a.driver.name, phone: a.driver.phone, plate: a.driver.vehicle?.plateNo ?? null, fromAgenda: false }
  }
  if (a?.vendor) {
    return { kind: 'vendor', name: a.vendor.name, phone: a.vendor.phone, plate: null, fromAgenda: false }
  }
  for (const m of b.tourAgenda?.items ?? []) {
    const asg = m.assignment
    if (!asg) continue
    const name = asg.driver?.name ?? asg.driverName ?? asg.vendor?.name ?? asg.vendorName
    if (!name) continue
    return {
      kind:  asg.driver || asg.driverName ? 'driver' : 'vendor',
      name,
      phone: asg.driver?.phone ?? asg.driverPhone ?? asg.vendor?.phone ?? null,
      plate: asg.vehiclePlate ?? null,
      fromAgenda: true,
    }
  }
  return null
}

/** Vehicle type shown on the board — allocation first, then the chart. */
function effectiveVehicleType(b: SLBooking): string | null {
  if (b.slDriverAllocation?.vehicleType) return b.slDriverAllocation.vehicleType
  return b.tourAgenda?.items.find(m => m.assignment?.vehicleType)?.assignment?.vehicleType ?? null
}

/**
 * True when this file still has to be given a driver. False for a Hotel Only
 * booking, and for one whose every movement on the chart is a leisure day or
 * marked Hotel Only — there is nothing to drive, so the allocation is complete.
 */
function needsDriver(b: SLBooking): boolean {
  return bookingNeedsDriver({
    vehicleType: effectiveVehicleType(b),
    items:       b.tourAgenda?.items ?? [],
  })
}

function allocationStatus(b: SLBooking): AllocStatus {
  if (b.slDriverAllocation?.isEmergency) return 'emergency'
  const eff = effectiveDriver(b)
  if (eff) return eff.kind === 'driver' ? 'assigned' : 'vendor'
  // No driver, and none required — done, not pending.
  return needsDriver(b) ? 'pending' : 'hotel_only'
}

/**
 * The reference the accounts system is asked about for a booking.
 *
 * The IS number first, because that is what both systems put on a file and
 * what the accounts resolver matches on most reliably; the control number is
 * the fallback for a booking OPS holds before an IS number was issued. The
 * booking ref is never sent — it is an OPS-internal id the accounts system has
 * never seen, and asking about it would only produce a confident "not found".
 */
function advanceRefFor(b: SLBooking): string | null {
  return (b.isNumber ?? b.cntlNumber ?? '').trim() || null
}

/**
 * How many bookings go up per request.
 *
 * Small on purpose: each one is a full re-derivation on the accounts host, and
 * a smaller chunk means the first figures appear sooner. The accounts endpoint
 * itself accepts forty.
 */
const ADVANCE_CHUNK = 12

function fmt(dt: string) {
  return new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtShort(dt: string) {
  return new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function toISO(dt: string) { return dt.slice(0, 10) }
function formatTime(t: string) {
  if (!t) return '—'
  if (t.includes(':')) return t
  if (t.length === 4) return `${t.slice(0, 2)}:${t.slice(2)}`
  return t
}
function todayISO() { return new Date().toISOString().slice(0, 10) }
function addDays(iso: string, n: number) {
  const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
function startOfWeek() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); return d.toISOString().slice(0, 10)
}
function endOfWeek() { return addDays(startOfWeek(), 6) }
function startOfMonth() {
  const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
}
function endOfMonth() {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return d.toISOString().slice(0, 10)
}

// ── VehiclePill ───────────────────────────────────────────────────────────────

function VehiclePill({ type, compact }: { type: string | null; compact?: boolean }) {
  const meta = vehicleMeta(type)
  if (!meta) return <span className="text-slate-600 text-xs">—</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold', meta.color, compact && 'px-2 py-0.5 text-[10px]')}>
      <span>{meta.icon}</span>{meta.label}
    </span>
  )
}

// ── Vehicle Selector ──────────────────────────────────────────────────────────

function VehicleSelector({ current, onChange, disabled }: {
  current: string | null; onChange: (v: VehicleType | null) => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const meta = vehicleMeta(current)
  return (
    <div ref={ref} className="relative inline-block">
      <button disabled={disabled} onClick={() => setOpen(o => !o)}
        className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all hover:brightness-110 focus:outline-none',
          meta ? meta.color : 'border-slate-700/40 bg-slate-800/50 text-slate-500 hover:text-slate-300',
          disabled && 'opacity-40 cursor-not-allowed')}
      >
        {meta ? <><span>{meta.icon}</span>{meta.label}</> : <span>Set vehicle</span>}
        <ChevronDown className="w-3 h-3 opacity-60 ml-0.5" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
          <div className="p-1">
            {VEHICLE_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false) }}
                className={cn('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors text-left',
                  current === opt.value ? opt.color : 'text-slate-400 hover:text-white hover:bg-slate-800')}
              >
                <span>{opt.icon}</span> {opt.label}
                {current === opt.value && <CheckCircle2 className="w-3 h-3 ml-auto" />}
              </button>
            ))}
            {current && (
              <>
                <div className="h-px bg-slate-800 my-1" />
                <button onClick={() => { onChange(null); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-colors"
                ><X className="w-3 h-3" /> Clear</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon: Icon, onClick, active }: {
  label: string; value: number; color: string; icon: React.FC<{ className?: string }>
  onClick?: () => void; active?: boolean
}) {
  return (
    <button onClick={onClick}
      className={cn('flex items-center gap-3 px-5 py-4 rounded-2xl border bg-slate-900/60 backdrop-blur-sm transition-all text-left w-full',
        color, active && 'ring-2 ring-offset-1 ring-offset-[#060a14]',
        onClick && 'hover:scale-[1.02] cursor-pointer', !onClick && 'cursor-default')}
    >
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', color.replace('border-', 'bg-').replace('/30', '/15').replace('/40', '/15'))}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-black text-white leading-none">{value}</p>
        <p className="text-xs text-slate-400 mt-0.5 font-medium">{label}</p>
      </div>
    </button>
  )
}

// ── Booking Detail Side Panel ─────────────────────────────────────────────────

function BookingDetailPanel({ booking, onClose }: { booking: SLBooking | null; onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'movements' | 'hotels' | 'itinerary'>('overview')
  useEffect(() => { if (booking) setTab('overview') }, [booking])
  if (!booking) return null
  const leadPax  = booking.passengers[0] ?? null
  const arrFlight = booking.flights[0] ?? null
  const status   = allocationStatus(booking)
  const panelDriver = effectiveDriver(booking)
  const paxTotal = booking.paxAdults + booking.paxChildren

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-xl z-50 flex flex-col bg-[#0c1225] border-l border-slate-800 shadow-2xl shadow-black/50">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800 sticky top-0 z-10 bg-[#0c1225]/95">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/25 flex items-center justify-center flex-shrink-0">
            <CountryFlag country="SRILANKA" className="w-6 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-base leading-tight">{booking.isNumber ?? booking.cntlNumber ?? booking.bookingRef}</p>
            <p className="text-slate-400 text-xs mt-0.5 truncate">{leadPax?.name ?? '—'} · {paxTotal} pax</p>
          </div>
          <div className={cn('px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider', STATUS_BADGE[status])}>{status}</div>
          <button onClick={onClose} className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex border-b border-slate-800 bg-[#0c1225]/90 flex-shrink-0">
          {([
            { key: 'overview',  label: 'Overview',  icon: Info },
            { key: 'movements', label: 'Movements', icon: Route },
            { key: 'hotels',    label: 'Hotels',    icon: Building2 },
            { key: 'itinerary', label: 'Itinerary', icon: CalendarDays },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn('flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-all border-b-2',
                tab === key ? 'border-yellow-500 text-yellow-400' : 'border-transparent text-slate-500 hover:text-slate-300')}
            ><Icon className="w-3.5 h-3.5" />{label}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <IB label="IS Number"    value={booking.isNumber ?? '—'} />
                <IB label="CNTL Number"  value={booking.cntlNumber ?? '—'} />
                <IB label="Booking Ref"  value={booking.bookingRef} />
                <IB label="File Handler" value={booking.fileHandler ?? '—'} />
                <IB label="Agent"        value={booking.agent ?? '—'} />
                <IB label="Arrival"      value={fmt(booking.arrivalDate)} />
                <IB label="Departure"    value={fmt(booking.departureDate)} />
                <IB label="Created"      value={fmt(booking.createdAt)} />
                <IB label="Status"       value={booking.status.replace(/_/g, ' ')} />
              </div>
              {leadPax && (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-2">Lead Passenger</p>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brand-500/15 border border-brand-500/25 flex items-center justify-center"><User2 className="w-4 h-4 text-brand-400" /></div>
                    <div><p className="text-white font-bold text-sm">{leadPax.name}</p>{leadPax.contact && <p className="text-slate-400 text-xs">{leadPax.contact}</p>}</div>
                  </div>
                </div>
              )}
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3">Passengers</p>
                <div className="flex gap-4">
                  <PaxChip label="Adults" count={booking.paxAdults} />
                  {booking.paxChildren > 0 && <PaxChip label="Children" count={booking.paxChildren} />}
                </div>
              </div>
              {booking.flights.length > 0 && (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5"><Plane className="w-3 h-3" />Flights</p>
                  <div className="space-y-2">
                    {booking.flights.map((f, i) => (
                      <div key={f.id} className="flex items-center gap-3 text-sm">
                        <span className="text-[10px] font-bold text-slate-600 w-5 text-center">{i === 0 ? 'ARR' : i === booking.flights.length - 1 ? 'DEP' : 'TRN'}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2"><span className="text-white font-bold text-xs font-mono">{f.flightNo}</span><span className="text-slate-500 text-xs">{f.fromApt} → {f.toApt}</span></div>
                          <div className="text-slate-400 text-[11px] mt-0.5">{fmt(f.date)} · {formatTime(f.depTime)} → {formatTime(f.arrTime)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className={cn('rounded-xl border p-4',
                status === 'assigned'   ? 'bg-emerald-500/5 border-emerald-500/25' :
                status === 'vendor'     ? 'bg-blue-500/5 border-blue-500/25' :
                status === 'hotel_only' ? 'bg-pink-500/5 border-pink-500/25' :
                status === 'emergency'  ? 'bg-red-500/5 border-red-500/30' : 'bg-slate-800/40 border-slate-700/40')}>
                <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5"><Car className="w-3 h-3" />Driver Allocation</p>
                {effectiveVehicleType(booking) && <div className="mb-2"><VehiclePill type={effectiveVehicleType(booking)} /></div>}
                {panelDriver ? (
                  <div className="flex items-center gap-3">
                    <div className={cn('w-9 h-9 rounded-full border flex items-center justify-center',
                      panelDriver.kind === 'driver' ? 'bg-emerald-500/15 border-emerald-500/25' : 'bg-blue-500/15 border-blue-500/25')}>
                      {panelDriver.kind === 'driver'
                        ? <UserCheck className="w-4 h-4 text-emerald-400" />
                        : <Truck className="w-4 h-4 text-blue-400" />}
                    </div>
                    <div>
                      <p className="text-white font-bold text-sm">{panelDriver.name}</p>
                      {panelDriver.phone && <p className="text-slate-400 text-xs">{panelDriver.phone}</p>}
                      {panelDriver.plate && <p className="text-slate-500 text-[11px]">{panelDriver.plate}</p>}
                      {panelDriver.fromAgenda && <p className="text-slate-500 text-[11px] italic">set on the movement chart</p>}
                    </div>
                  </div>
                ) : status === 'hotel_only' ? (
                  <div className="flex items-start gap-2">
                    <Building2 className="w-4 h-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-pink-400 font-bold text-sm">No driver needed</p>
                      <p className="text-pink-300/60 text-[11px] mt-0.5">
                        {effectiveVehicleType(booking) === HOTEL_ONLY_VEHICLE
                          ? 'Hotel Only booking — this file carries no transport.'
                          : 'Every movement on the chart is a leisure day or hotel only.'}
                      </p>
                    </div>
                  </div>
                ) : <p className="text-slate-500 text-sm italic">No driver assigned yet</p>}
                {booking.slDriverAllocation?.isEmergency && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div><p className="text-red-400 text-xs font-semibold">Emergency Change</p>{booking.slDriverAllocation.changeReason && <p className="text-red-300/70 text-[11px] mt-0.5">{booking.slDriverAllocation.changeReason}</p>}</div>
                  </div>
                )}
              </div>
              {booking.importantNotes && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                  <p className="text-amber-400 text-[10px] uppercase tracking-wider font-semibold mb-1">Important Notes</p>
                  <p className="text-amber-300/80 text-xs leading-relaxed">{booking.importantNotes}</p>
                </div>
              )}
            </div>
          )}
          {tab === 'movements' && (
            <div className="space-y-3">
              {!booking.tourAgenda?.items?.length ? (
                <EmptyTab label="No movements added yet" icon={Route} />
              ) : booking.tourAgenda.items.map((m, i) => (
                <div key={m.id} className="relative pl-5">
                  {i < booking.tourAgenda!.items.length - 1 && <div className="absolute left-1.5 top-5 bottom-0 w-px bg-slate-700/60" />}
                  <div className="absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-yellow-500/60 bg-[#0c1225]" />
                  <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <p className="text-white font-bold text-sm">{m.location}</p>
                        {(m.fromPoint || m.toPoint) && <p className="text-slate-400 text-xs mt-0.5">{m.fromPoint}{m.fromPoint && m.toPoint && <ArrowRight className="inline w-3 h-3 mx-1" />}{m.toPoint}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-slate-400 text-[11px]">{fmtShort(m.date)}</p>
                        {(m.timeFrom || m.timeTo) && <p className="text-yellow-400/70 text-[11px] font-mono mt-0.5">{m.timeFrom && formatTime(m.timeFrom)}{m.timeFrom && m.timeTo && ' – '}{m.timeTo && formatTime(m.timeTo)}</p>}
                      </div>
                    </div>
                    {m.details && <p className="text-slate-400 text-xs leading-relaxed line-clamp-3 mt-1">{m.details}</p>}
                    {/* Same no-driver markers the Movement Chart shows, so the two screens read alike */}
                    {!movementNeedsDriver(m) ? (
                      <div className="mt-2 pt-2 border-t border-slate-700/40 flex items-center gap-2 text-xs">
                        {resolveIsHotelOnly(m)
                          ? <><Building2 className="w-3 h-3 text-pink-400" /><span className="text-pink-400 font-semibold">Hotel only — no driver required</span></>
                          : <><Palmtree className="w-3 h-3 text-amber-400" /><span className="text-amber-400 font-semibold">Leisure day — no driver required</span></>}
                      </div>
                    ) : m.assignment && <div className="mt-2 pt-2 border-t border-slate-700/40 flex items-center gap-2 text-xs"><Car className="w-3 h-3 text-slate-500" /><span className="text-slate-400">{m.assignment.driverName ?? m.assignment.driver?.name ?? m.assignment.vendor?.name ?? '—'}</span>{m.assignment.vehicleType && <VehiclePill type={m.assignment.vehicleType} compact />}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'hotels' && (
            <div className="space-y-3">
              {!booking.accommodations.length ? <EmptyTab label="No hotel accommodations found" icon={Building2} /> :
                booking.accommodations.map(a => (
                  <div key={a.id} className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5"><Building2 className="w-4 h-4 text-blue-400" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-bold text-sm">{a.hotel}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{a.city}</p>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                          <div><p className="text-slate-600 uppercase tracking-wider">Check-in</p><p className="text-slate-300 font-medium">{fmtShort(a.checkIn)}</p></div>
                          <div><p className="text-slate-600 uppercase tracking-wider">Check-out</p><p className="text-slate-300 font-medium">{fmtShort(a.checkOut)}</p></div>
                          <div><p className="text-slate-600 uppercase tracking-wider">Nights</p><p className="text-slate-300 font-medium">{a.nights}N</p></div>
                        </div>
                        {(a.roomType || a.mealType) && <div className="mt-2 flex gap-2">{a.roomType && <span className="px-2 py-0.5 rounded-md bg-slate-700/50 text-slate-400 text-[10px] font-semibold">{a.roomType}</span>}{a.mealType && <span className="px-2 py-0.5 rounded-md bg-slate-700/50 text-slate-400 text-[10px] font-semibold">{a.mealType}</span>}</div>}
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
          {tab === 'itinerary' && (
            <div className="space-y-3">
              {!booking.itineraryItems.length ? <EmptyTab label="No itinerary items found" icon={CalendarDays} /> :
                booking.itineraryItems.map(item => (
                  <div key={item.id} className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center flex-shrink-0"><span className="text-yellow-400 text-[10px] font-black">D{item.dayNo}</span></div>
                      <div><p className="text-white font-bold text-sm">{item.title}</p><p className="text-slate-500 text-[11px]">{fmt(item.date)}</p></div>
                    </div>
                    {item.description && <p className="text-slate-400 text-xs leading-relaxed ml-10 line-clamp-4">{item.description}</p>}
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function IB({ label, value }: { label: string; value: string }) {
  return <div><p className="text-slate-600 text-[10px] uppercase tracking-wider font-semibold">{label}</p><p className="text-white text-xs font-semibold mt-0.5">{value}</p></div>
}
function PaxChip({ label, count }: { label: string; count: number }) {
  return <div className="text-center"><p className="text-white text-lg font-black leading-none">{count}</p><p className="text-slate-500 text-[10px] mt-0.5">{label}</p></div>
}
function EmptyTab({ label, icon: Icon }: { label: string; icon: React.FC<{ className?: string }> }) {
  return <div className="flex flex-col items-center justify-center py-14 text-center"><div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700/40 flex items-center justify-center mb-3"><Icon className="w-5 h-5 text-slate-600" /></div><p className="text-slate-500 text-sm">{label}</p></div>
}

// ── Driver Advance: the board cell ────────────────────────────────────────────

/**
 * What the driver of this booking leaves with, as the accounts system works it
 * out. One cell per booking, and a button into the full explanation.
 *
 * Deliberately quiet when there is nothing to say. A Sri Lanka file that the
 * accounts system has not costed yet is normal — the P&L arrives after the
 * booking does — and a red error on every such row would train people to
 * ignore the column. Only a genuine failure to reach accounts is coloured.
 */
function DriverAdvanceCell({ summary, loading, onOpen }: {
  summary: DriverAdvanceSummary | undefined
  loading: boolean
  onOpen: () => void
}) {
  if (!summary) {
    return loading
      ? <div className="flex items-center gap-1.5 text-slate-600 text-[11px]"><Loader2 className="w-3 h-3 animate-spin" />reading…</div>
      : <span className="text-slate-700 text-xs">—</span>
  }

  if (summary.state === 'unavailable' || summary.state === 'error') {
    return (
      <span title={summary.message ?? undefined}
        className="inline-flex items-center gap-1.5 text-amber-500/80 text-[11px]">
        <AlertTriangle className="w-3 h-3" />unavailable
      </span>
    )
  }

  if (summary.state === 'no_pnl' || summary.state === 'no_lines') {
    return (
      <span title={summary.message ?? undefined} className="text-slate-600 text-[11px] italic">
        {summary.state === 'no_pnl' ? 'no P&L yet' : 'not costed yet'}
      </span>
    )
  }

  const stage = summary.stage ?? 'advance_due'
  const hasRate = summary.rate_available !== false && summary.amount_lkr !== null && summary.amount_lkr !== undefined

  return (
    <button onClick={onOpen}
      className="group/adv flex flex-col items-start gap-1 text-left rounded-lg -mx-1.5 -my-1 px-1.5 py-1 hover:bg-emerald-500/5 transition-colors"
      title="Show how this figure was calculated"
    >
      <span className="flex items-center gap-1.5">
        <Wallet className="w-3 h-3 text-emerald-500/70 group-hover/adv:text-emerald-400 transition-colors" />
        <span className="font-mono font-black text-xs text-emerald-300 group-hover/adv:text-emerald-200 transition-colors">
          {hasRate ? lkr(summary.amount_lkr) : money(summary.amount, summary.currency)}
        </span>
        {summary.edited && (
          <PencilLine className="w-3 h-3 text-amber-400" aria-label="Edited by hand" />
        )}
      </span>

      <span className="flex items-center gap-1">
        <span className={cn('px-1.5 py-px rounded border text-[9px] font-bold uppercase tracking-wide', STAGE_TONE[stage])}>
          {stage === 'advance_due' ? 'to pay' : stage === 'rest_due' ? 'rest due' : stage === 'settled' ? 'settled' : 'empty'}
        </span>
        {/* The payment gate, not the arithmetic: Payable 1.0 will not release
            money on a booking whose P&L nobody has approved. Worth seeing here,
            because it is the reason a driver has not been paid. */}
        {summary.payable === false && (
          <span className="px-1.5 py-px rounded border border-orange-500/25 bg-orange-500/10 text-orange-300/90 text-[9px] font-bold uppercase tracking-wide">
            P&amp;L {summary.pnl_approval ?? 'pending'}
          </span>
        )}
      </span>

      {!hasRate && <span className="text-slate-600 text-[9px]">no LKR rate on file</span>}
    </button>
  )
}

// ── Driver Advance: the explanation ───────────────────────────────────────────

/**
 * The whole calculation, opened from a cell.
 *
 * Reads top-down as the arithmetic actually runs: what the envelope comes to,
 * which sections went into it and on what basis, every line inside them, what
 * was deliberately left out, what a human changed, and what has already been
 * handed over. Everything here was computed by the accounts system — this
 * component formats, it does not add up.
 */
function DriverAdvanceModal({ booking, onClose }: { booking: SLBooking | null; onClose: () => void }) {
  const [detail, setDetail]   = useState<DriverAdvanceDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [tab, setTab]         = useState<'summary' | 'lines' | 'payments'>('summary')

  useEffect(() => {
    if (!booking) { setDetail(null); setError(null); return }

    const reference = advanceRefFor(booking)
    if (!reference) { setError('This booking has no IS or control number to look up.'); return }

    let cancelled = false
    setLoading(true); setError(null); setDetail(null); setTab('summary')

    const params = new URLSearchParams({ reference })
    if (booking.cntlNumber) params.set('control', booking.cntlNumber)

    fetch(`/api/srilanka/driver-advance?${params.toString()}`)
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) { setError(json?.error ?? `The accounts system answered ${res.status}.`); return }
        setDetail(json.data?.advance ?? null)
      })
      .catch(() => { if (!cancelled) setError('The accounts system could not be reached.') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [booking])

  if (!booking) return null

  const usingLkr = detail?.lkr.available ?? false
  /** One formatter for the whole window, so no two figures are quoted differently. */
  const show = (lkrValue: number | null | undefined, native: number | null | undefined) =>
    usingLkr ? lkr(lkrValue) : money(native, detail?.currency ?? 'USD')

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#0c1225] border border-slate-800 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">

          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 flex-shrink-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
              <Wallet className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-black text-base leading-tight">Driver Advance</p>
              <p className="text-slate-400 text-xs mt-0.5 truncate">
                {booking.isNumber ?? booking.bookingRef}
                {booking.cntlNumber && <span className="text-slate-600"> · {booking.cntlNumber}</span>}
                {detail?.client_name && <span> · {detail.client_name}</span>}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><X className="w-4 h-4" /></button>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-7 h-7 text-slate-600 animate-spin" />
              <p className="text-slate-500 text-xs">Re-deriving this booking in the accounts system…</p>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-20 px-8 text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700/40 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-500/70" />
              </div>
              <p className="text-slate-300 text-sm font-semibold">No driver advance to show</p>
              <p className="text-slate-500 text-xs max-w-md">{error}</p>
            </div>
          )}

          {!loading && !error && detail && (
            <>
              {/* The figure */}
              <div className="px-6 py-5 border-b border-slate-800 bg-gradient-to-b from-emerald-500/5 to-transparent flex-shrink-0">
                <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase tracking-wider font-bold">Advance to hand over</p>
                    <p className="text-emerald-300 text-3xl font-black font-mono leading-tight mt-1">
                      {show(detail.lkr.effective, detail.effective)}
                    </p>
                    {usingLkr && detail.lkr.rate && (
                      <p className="text-slate-600 text-[10px] mt-1">
                        at USD 1 = {detail.lkr.rate.toFixed(4)}
                        {detail.lkr.all_fixed ? ' · rate fixed' : ' · live rate'}
                        {detail.lkr.partial && ' · some lines have no rate'}
                      </p>
                    )}
                  </div>

                  <Figure label="Whole tour will cost" value={show(detail.lkr.obligation, detail.obligation)} />
                  <Figure label="Already paid" value={show(detail.lkr.paid, detail.paid)} tone="text-sky-300" />
                  <Figure label="Advance still due" value={show(detail.lkr.advance_outstanding, detail.advance_outstanding)} tone="text-amber-300" />
                  <Figure label="Rest after the tour" value={show(detail.lkr.rest_outstanding, detail.rest_outstanding)} tone="text-slate-300" />

                  <div className="ml-auto flex flex-col items-end gap-1.5">
                    <span className={cn('px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider', STAGE_TONE[detail.stage])}>
                      {detail.stage_label}
                    </span>
                    {!detail.payable && (
                      <span className="px-2.5 py-1 rounded-full border border-orange-500/25 bg-orange-500/10 text-orange-300 text-[10px] font-bold uppercase tracking-wider">
                        P&amp;L {detail.pnl_approval} — not payable
                      </span>
                    )}
                  </div>
                </div>

                {/* How far through the whole obligation this booking is. */}
                <div className="mt-4 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, detail.progress))}%` }} />
                </div>
                <p className="text-slate-600 text-[10px] mt-1.5">
                  {detail.progress.toFixed(1)}% of the tour&apos;s {detail.line_count} costed line{detail.line_count === 1 ? '' : 's'} settled
                  {detail.source === 'ledger' && ' · rebuilt from stored payable rows'}
                </p>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-800 flex-shrink-0">
                {([
                  { key: 'summary',  label: 'Calculation', icon: Calculator },
                  { key: 'lines',    label: `Lines (${detail.lines.length})`, icon: FileText },
                  { key: 'payments', label: `Payments (${detail.history.length})`, icon: History },
                ] as const).map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => setTab(key)}
                    className={cn('flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-all border-b-2',
                      tab === key ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-300')}
                  ><Icon className="w-3.5 h-3.5" />{label}</button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {tab === 'summary'  && <AdvanceCalculation detail={detail} usingLkr={usingLkr} />}
                {tab === 'lines'    && <AdvanceLines detail={detail} />}
                {tab === 'payments' && <AdvancePayments detail={detail} />}
              </div>

              <div className="px-6 py-3 border-t border-slate-800 flex items-center gap-2 flex-shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                <p className="text-slate-600 text-[10px] leading-snug">
                  Read-only. Calculated live by the Apple Accounts system (Payable 1.0 › Driver Settlements);
                  money is released and edited there, never from this board.
                  {detail.updated_at && ` Envelope last edited ${detail.updated_at}${detail.updated_by ? ` by ${detail.updated_by}` : ''}.`}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Figure({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-slate-500 text-[10px] uppercase tracking-wider font-bold">{label}</p>
      <p className={cn('text-sm font-black font-mono mt-1', tone)}>{value}</p>
    </div>
  )
}

/** The sections, the rule each was priced by, and what a human changed. */
function AdvanceCalculation({ detail, usingLkr }: { detail: DriverAdvanceDetail; usingLkr: boolean }) {
  const amount = (l: number, n: number) => usingLkr ? lkr(l) : money(n, detail.currency)
  const included = detail.sections.filter(s => s.included)
  const excluded = detail.sections.filter(s => !s.included)

  return (
    <div className="space-y-4">
      {/* The rule, in words, before any numbers. */}
      <div className="bg-slate-800/30 border border-slate-700/40 rounded-xl p-4">
        <p className="text-slate-500 text-[10px] uppercase tracking-wider font-bold mb-2">How this is worked out</p>
        <p className="text-slate-300 text-xs leading-relaxed">
          The driver is handed <span className="text-emerald-300 font-semibold">
            {detail.transport_basis === 'full' ? 'the whole transport bill' : `${detail.percent}% of the transport`}
          </span>
          {included.filter(s => s.code !== 'TRANSPORT').length > 0 && (
            <> plus the full cost of {included.filter(s => s.code !== 'TRANSPORT').map(s => s.label.toLowerCase()).join(', ')}</>
          )}
          , because those are what he pays out on the road. Everything left over is settled with him after the tour.
        </p>
      </div>

      {/* Included sections */}
      <div className="space-y-2">
        {included.map(s => (
          <div key={s.code} className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3.5">
            <div className="flex items-start gap-3">
              <span className={cn('px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide flex-shrink-0 mt-0.5', CATEGORY_TONE[s.code])}>
                {s.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-slate-400 text-[11px]">{s.basis_note}</p>
                <p className="text-slate-600 text-[10px] mt-0.5">
                  {s.line_count} line{s.line_count === 1 ? '' : 's'}
                  {s.held_count > 0 && ` · ${s.held_count} on hold, excluded`}
                  {' · costs '}{amount(s.lkr_total, s.total)}
                  {s.paid > 0 && ` · ${amount(s.lkr_paid, s.paid)} already paid`}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-white font-black font-mono text-sm">{amount(s.contribution_lkr, s.contribution)}</p>
                {/* Transport is the only section that can put in less than it
                    costs, so the subtraction is spelled out where it happens. */}
                {s.code === 'TRANSPORT' && s.basis === 'advance' && s.total > s.contribution && (
                  <p className="text-slate-600 text-[10px]">of {amount(s.lkr_total, s.total)}</p>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* The total, as an addition rather than an assertion. */}
        <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5">
          <Calculator className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <p className="text-emerald-200 text-xs font-bold flex-1">Computed advance</p>
          <p className="text-emerald-300 font-black font-mono text-base">{amount(detail.lkr.computed, detail.computed)}</p>
        </div>
      </div>

      {/* The override — shown as a correction to the figure above it. */}
      {detail.override && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <PencilLine className="w-3.5 h-3.5 text-amber-400" />
            <p className="text-amber-300 text-xs font-bold">Fixed by hand at {lkr(detail.override.amount_lkr)}</p>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            {detail.override.reason || 'No reason was recorded.'}
          </p>
          <p className="text-slate-600 text-[10px] mt-2">
            {detail.override.by ? `Set by ${detail.override.by}` : 'Author unknown'}
            {detail.override.at && ` on ${detail.override.at}`}
            {Math.abs(detail.override.drift_lkr) >= 0.01 && (
              <> · the computed figure has since moved by {lkr(Math.abs(detail.override.drift_lkr))}
                {detail.override.drift_lkr > 0 ? ' below' : ' above'} this one</>
            )}
          </p>
          {detail.override.capped && (
            <p className="text-red-300/90 text-[10px] mt-1.5">
              This override is larger than the whole tour costs — the accounts system caps it at the obligation.
            </p>
          )}
        </div>
      )}

      {/* Sections deliberately left out */}
      {excluded.length > 0 && (
        <div className="bg-slate-800/20 border border-slate-700/30 rounded-xl p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <MinusCircle className="w-3.5 h-3.5 text-slate-600" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider font-bold">Not in the envelope</p>
          </div>
          <div className="space-y-1">
            {excluded.map(s => (
              <p key={s.code} className="text-slate-500 text-[11px] flex items-center gap-2">
                <span className="w-20 flex-shrink-0">{s.label}</span>
                <span className="text-slate-600">
                  {s.line_count === 0
                    ? 'nothing on this booking'
                    : `${s.line_count} line${s.line_count === 1 ? '' : 's'} worth ${amount(s.lkr_total, s.total)} — settled by the office`}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Held lines — costed, but not travelling with the driver yet. */}
      {detail.held_lines.length > 0 && (
        <div className="bg-slate-800/20 border border-slate-700/30 rounded-xl p-3.5">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider font-bold mb-2">
            On hold — excluded until released ({detail.held_lines.length})
          </p>
          <div className="space-y-1">
            {detail.held_lines.map((h, i) => (
              <p key={h.line_key ?? i} className="text-slate-500 text-[11px] flex items-center gap-2">
                <span className={cn('px-1.5 py-px rounded border text-[9px] font-bold uppercase flex-shrink-0', CATEGORY_TONE[h.category])}>{h.category_label}</span>
                <span className="flex-1 truncate">{h.activity_name}</span>
                <span className="font-mono text-slate-600">{lkr(h.lkr_amount)}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Where the transport figure came from — the same number Payable 1.0's
          Transport panel quotes, so the two screens are visibly agreeing. */}
      {detail.transport && (
        <div className="bg-slate-800/30 border border-slate-700/40 rounded-xl p-3.5">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider font-bold mb-2">Transport settlement</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <IB label="Transport total"  value={lkr(detail.transport.lkr_total)} />
            <IB label={`${detail.percent}% advance`} value={lkr(detail.transport.lkr_advance_due)} />
            <IB label="Paid"             value={money(detail.transport.paid, detail.currency)} />
            <IB label="Outstanding"      value={money(detail.transport.outstanding, detail.currency)} />
          </div>
          {detail.transport.deduction_applied && (
            <p className="text-slate-600 text-[10px] mt-2">
              {lkr(detail.transport.deduction_lkr)} is held back from every booking&apos;s transport advance.
            </p>
          )}
        </div>
      )}

      {detail.notes && (
        <div className="bg-slate-800/20 border border-slate-700/30 rounded-xl p-3.5">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider font-bold mb-1.5">Notes</p>
          <p className="text-slate-300 text-xs whitespace-pre-wrap leading-relaxed">{detail.notes}</p>
        </div>
      )}
    </div>
  )
}

/** Every line in the envelope, grouped the way the sections above list them. */
function AdvanceLines({ detail }: { detail: DriverAdvanceDetail }) {
  if (detail.lines.length === 0) {
    return <EmptyTab label="No costed lines are in this driver's envelope" icon={FileText} />
  }

  const order = detail.sections.map(s => s.code)
  const groups = order
    .map(code => ({ code, lines: detail.lines.filter(l => l.category === code) }))
    .filter(g => g.lines.length > 0)

  return (
    <div className="space-y-4">
      {groups.map(({ code, lines }) => (
        <div key={code}>
          <div className="flex items-center gap-2 mb-2">
            <span className={cn('px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide', CATEGORY_TONE[code as DriverAdvanceCategory])}>
              {detail.sections.find(s => s.code === code)?.label ?? code}
            </span>
            <span className="text-slate-600 text-[10px]">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/60 bg-slate-900/40">
                  {['Activity', 'Supplier', 'Status', 'Cost', 'In envelope', 'Paid', 'Balance'].map((h, i) => (
                    <th key={h} className={cn('px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap',
                      i >= 3 ? 'text-right' : 'text-left')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {lines.map((l, i) => (
                  <tr key={l.line_key ?? i} className={i % 2 ? 'bg-slate-900/20' : ''}>
                    <td className="px-3 py-2 text-slate-200 max-w-[16rem] truncate" title={l.activity_name}>{l.activity_name}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-[10rem] truncate">{l.supplier_name ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{l.status}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300 whitespace-nowrap">
                      {l.lkr_amount !== null ? lkr(l.lkr_amount) : money(l.actual_amount, l.currency)}
                    </td>
                    {/* What this line contributes to the advance. Lower than its
                        cost on transport, which is pro-rated to the advance share. */}
                    <td className="px-3 py-2 text-right font-mono text-emerald-300/90 whitespace-nowrap">
                      {l.rate ? lkr(l.advance_weight * l.rate) : money(l.advance_weight, l.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sky-300/80 whitespace-nowrap">
                      {l.paid_amount > 0 ? money(l.paid_amount, l.currency) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400 whitespace-nowrap">
                      {l.lkr_balance !== null ? lkr(l.lkr_balance) : money(l.balance, l.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

/** What has actually been handed over, newest first — one row per bank slip. */
function AdvancePayments({ detail }: { detail: DriverAdvanceDetail }) {
  if (detail.history.length === 0) {
    return <EmptyTab label="Nothing has been paid to this driver yet" icon={Banknote} />
  }

  return (
    <div className="space-y-2">
      {detail.history.map(p => (
        <div key={p.receipt_ref} className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3.5">
          <div className="flex items-start gap-3">
            <div className={cn('w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0',
              p.stage === 'driver_advance'
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                : 'bg-sky-500/10 border-sky-500/25 text-sky-400')}>
              <Banknote className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-bold">{p.stage_label}</p>
              <p className="text-slate-500 text-[10px] mt-0.5">
                {p.date ?? 'undated'} · {p.line_count} line{p.line_count === 1 ? '' : 's'}
                {p.reference && ` · ref ${p.reference}`}
                {p.recorded_by && ` · by ${p.recorded_by}`}
              </p>
              {p.remarks && <p className="text-slate-500 text-[11px] mt-1 italic">{p.remarks}</p>}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-white font-black font-mono text-sm">{lkr(p.amount_lkr)}</p>
              <p className="text-slate-600 text-[10px] font-mono">{money(p.amount, p.currency)}</p>
              <p className="text-slate-700 text-[9px] font-mono mt-0.5">{p.receipt_ref}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Driver Assign Modal ───────────────────────────────────────────────────────

function DriverAssignModal({ booking, drivers, vendors, onClose, onSave }: {
  booking: SLBooking | null
  drivers: DriverInfo[]; vendors: VendorInfo[]
  onClose: () => void
  onSave: (data: { bookingId: string; driverId?: string | null; vendorId?: string | null; notes?: string; isEmergency?: boolean; changeReason?: string }) => Promise<void>
}) {
  const [tab, setTab] = useState<'driver' | 'vendor'>('driver')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<{ type: 'driver' | 'vendor'; id: string; name: string } | null>(null)
  const [notes, setNotes] = useState('')
  const [isEmergency, setIsEmergency] = useState(false)
  const [emergencyReason, setEmergencyReason] = useState('')
  const [saving, setSaving] = useState(false)
  const alreadyHasDriver = !!(booking?.slDriverAllocation?.driverId || booking?.slDriverAllocation?.vendorId)

  useEffect(() => {
    if (booking) { setSearch(''); setSelected(null); setNotes(booking.slDriverAllocation?.notes ?? ''); setIsEmergency(false); setEmergencyReason('') }
  }, [booking])

  const filteredDrivers = useMemo(() => {
    const q = search.toLowerCase()
    return drivers.filter(d => d.name.toLowerCase().includes(q) || d.phone.includes(q) || (d.vehicle?.plateNo ?? '').toLowerCase().includes(q))
  }, [drivers, search])

  const filteredVendors = useMemo(() => {
    const q = search.toLowerCase()
    return vendors.filter(v => v.name.toLowerCase().includes(q) || (v.phone ?? '').includes(q))
  }, [vendors, search])

  const canSave = selected && (!alreadyHasDriver || (isEmergency && emergencyReason.trim()))

  async function handleSave() {
    if (!booking || !selected) return
    setSaving(true)
    try {
      await onSave({ bookingId: booking.id, driverId: tab === 'driver' ? selected.id : null, vendorId: tab === 'vendor' ? selected.id : null, notes, isEmergency, changeReason: emergencyReason || undefined })
      onClose()
    } finally { setSaving(false) }
  }

  if (!booking) return null
  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-lg bg-[#0c1225] border border-slate-700/60 rounded-2xl shadow-2xl shadow-black/60 pointer-events-auto flex flex-col max-h-[85vh]">
          <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center"><Car className="w-5 h-5 text-teal-400" /></div>
            <div className="flex-1 min-w-0"><p className="text-white font-black text-base">Assign Driver</p><p className="text-slate-400 text-xs mt-0.5 truncate">{booking.isNumber ?? booking.cntlNumber ?? booking.bookingRef} · {booking.passengers[0]?.name ?? 'Unknown'}</p></div>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
          </div>
          {alreadyHasDriver && (
            <div className="mx-5 mt-4 px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/25 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div><p className="text-amber-400 text-sm font-semibold">Driver Already Assigned</p><p className="text-amber-300/70 text-xs mt-0.5 leading-relaxed">Sri Lanka bookings use a single driver. Changing requires emergency mode.</p></div>
            </div>
          )}
          <div className="flex border-b border-slate-800 mx-5 mt-4 flex-shrink-0">
            {(['driver', 'vendor'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setSelected(null); setSearch('') }}
                className={cn('flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-all border-b-2 capitalize',
                  tab === t ? 'border-teal-500 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-300')}
              >{t === 'driver' ? <User2 className="w-3.5 h-3.5" /> : <Truck className="w-3.5 h-3.5" />}{t === 'driver' ? 'Driver' : 'Vendor'}</button>
            ))}
          </div>
          <div className="px-5 pt-4 flex-shrink-0">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" /><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${tab}s…`} className="w-full pl-9 pr-4 py-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-teal-500/50" /></div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-3 pt-3 space-y-2">
            {tab === 'driver' ? (filteredDrivers.length === 0 ? <p className="text-center text-slate-600 text-sm py-8">No drivers found</p> : filteredDrivers.map(d => (
              <button key={d.id} onClick={() => setSelected({ type: 'driver', id: d.id, name: d.name })}
                className={cn('w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all', selected?.id === d.id ? 'bg-teal-500/10 border-teal-500/40' : 'bg-slate-800/40 border-slate-700/30 hover:bg-slate-800/70')}
              >
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-black', d.isActive ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' : 'bg-slate-700/50 border border-slate-600/30 text-slate-500')}>{d.name.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1 min-w-0"><p className={cn('font-bold text-sm truncate', selected?.id === d.id ? 'text-teal-300' : 'text-white')}>{d.name}</p><p className="text-slate-500 text-xs">{d.phone}</p>{d.vehicle && <p className="text-slate-600 text-[11px]">{d.vehicle.type} · {d.vehicle.plateNo}</p>}</div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold border', d.isActive ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-slate-700/50 border-slate-600/30 text-slate-500')}>{d.isActive ? 'Active' : 'Inactive'}</span>
                  {selected?.id === d.id && <CheckCircle2 className="w-4 h-4 text-teal-400" />}
                </div>
              </button>
            ))) : (filteredVendors.length === 0 ? <p className="text-center text-slate-600 text-sm py-8">No vendors found</p> : filteredVendors.map(v => (
              <button key={v.id} onClick={() => setSelected({ type: 'vendor', id: v.id, name: v.name })}
                className={cn('w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all', selected?.id === v.id ? 'bg-blue-500/10 border-blue-500/40' : 'bg-slate-800/40 border-slate-700/30 hover:bg-slate-800/70')}
              >
                <div className="w-9 h-9 rounded-full bg-blue-500/10 border border-blue-500/25 flex items-center justify-center flex-shrink-0 text-[10px] font-black text-blue-300">{v.name.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1 min-w-0"><p className={cn('font-bold text-sm truncate', selected?.id === v.id ? 'text-blue-300' : 'text-white')}>{v.name}</p>{v.phone && <p className="text-slate-500 text-xs">{v.phone}</p>}</div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold border', v.isActive ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-slate-700/50 border-slate-600/30 text-slate-500')}>{v.isActive ? 'Active' : 'Inactive'}</span>
                  {selected?.id === v.id && <CheckCircle2 className="w-4 h-4 text-blue-400" />}
                </div>
              </button>
            )))}
          </div>
          <div className="px-5 pb-4 pt-3 border-t border-slate-800 space-y-3 flex-shrink-0">
            {selected && <div className="px-3 py-2 rounded-xl bg-teal-500/8 border border-teal-500/20 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 flex-shrink-0" /><p className="text-teal-300 text-sm font-semibold truncate">{selected.name}</p></div>}
            {alreadyHasDriver && (
              <label className="flex items-center gap-3 cursor-pointer">
                <button type="button" onClick={() => setIsEmergency(e => !e)} className={cn('relative w-10 h-5 rounded-full transition-colors flex-shrink-0', isEmergency ? 'bg-red-500' : 'bg-slate-700')}>
                  <span className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform', isEmergency ? 'translate-x-5' : 'translate-x-0.5')} />
                </button>
                <span className={cn('text-sm font-semibold', isEmergency ? 'text-red-400' : 'text-slate-400')}>Emergency Change</span>
                {isEmergency && <Shield className="w-3.5 h-3.5 text-red-400" />}
              </label>
            )}
            {isEmergency && <input type="text" value={emergencyReason} onChange={e => setEmergencyReason(e.target.value)} placeholder="Reason for emergency change (required)…" className="w-full px-3 py-2 bg-red-500/5 border border-red-500/25 rounded-xl text-red-300 text-sm placeholder:text-red-500/50 focus:outline-none focus:border-red-500/50" />}
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)…" className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-slate-300 text-sm placeholder:text-slate-600 focus:outline-none focus:border-slate-600" />
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-700/40 text-slate-400 text-sm font-semibold hover:text-white hover:bg-slate-800 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={!canSave || saving}
                className={cn('flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2',
                  canSave && !saving ? 'bg-teal-500 hover:bg-teal-400 text-white shadow-lg shadow-teal-500/25' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700/40')}
              >{saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <>Confirm Assign</>}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SriLankaDriverAllocationPage() {
  const { data: session } = useSession()

  // Raw data
  const [bookings, setBookings]   = useState<SLBooking[]>([])
  const [drivers, setDrivers]     = useState<DriverInfo[]>([])
  const [vendors, setVendors]     = useState<VendorInfo[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Active-only switch — hides bookings where departureDate has already passed (default ON)
  const [activeOnly, setActiveOnly] = useState(true)

  // Search & Status & Vehicle (applied client-side)
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [vehicleFilter, setVehicleFilter] = useState('')

  // Date range (client-side)
  const [dateField, setDateField] = useState<DateField>('arrivalDate')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')

  // Sort (client-side)
  const [sortBy, setSortBy]   = useState<SortField>('arrivalDate')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Modals
  const [detailBooking, setDetailBooking] = useState<SLBooking | null>(null)
  const [assignBooking, setAssignBooking] = useState<SLBooking | null>(null)
  const [advanceBooking, setAdvanceBooking] = useState<SLBooking | null>(null)

  // ── Driver advance (from the Apple Accounts system) ───────────────────────
  //
  // Held apart from `bookings` because it arrives on its own schedule: the
  // figures are re-derived per booking on the accounts host, so the column
  // fills in progressively rather than blocking the board. Keyed by the exact
  // reference that was sent, which is the same string the accounts system
  // echoes back — no second normalisation on this side to disagree with theirs.
  const [advances, setAdvances] = useState<Record<string, DriverAdvanceSummary>>({})
  const [advancesLoading, setAdvancesLoading] = useState(false)
  const [advanceNotice, setAdvanceNotice] = useState<string | null>(null)

  // References already asked about, so a filter change never re-fetches a
  // figure that is already on screen. A ref rather than state: it must be read
  // and written inside one pass of the loader without re-triggering it.
  const askedRefs = useRef<Set<string>>(new Set())
  const advanceRun = useRef(0)
  // Loaders can overlap — clearing a filter reveals more rows while the first
  // pass is still running — so the spinner is driven by a count, not a flag.
  const advanceInFlight = useRef(0)

  // ── Fetch (no filter params — all filtering is client-side) ───────────────

  const fetchBookings = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true)
    try {
      const res = await fetch('/api/srilanka/driver-allocation')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setBookings(data.data ?? data)
    } catch {
      toast.error('Failed to load Sri Lanka bookings')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [])

  const fetchDriversAndVendors = useCallback(async () => {
    const [dRes, vRes] = await Promise.all([
      fetch('/api/ground/drivers?country=SRILANKA'),
      fetch('/api/ground/vendors?country=SRILANKA'),
    ])
    if (dRes.ok) { const d = await dRes.json(); setDrivers(d.data ?? d) }
    if (vRes.ok) { const v = await vRes.json(); setVendors(v.data ?? v) }
  }, [])

  useEffect(() => { fetchBookings() },           [fetchBookings])
  useEffect(() => { fetchDriversAndVendors() },  [fetchDriversAndVendors])

  // ── Client-side filter + sort ─────────────────────────────────────────────

  const displayBookings = useMemo(() => {
    let list = [...bookings]

    // Active-only: hide bookings whose departure date has already passed
    if (activeOnly) {
      const today = todayISO()
      list = list.filter(b => toISO(b.departureDate) >= today)
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(b =>
        (b.isNumber    ?? '').toLowerCase().includes(q) ||
        (b.cntlNumber  ?? '').toLowerCase().includes(q) ||
        b.bookingRef.toLowerCase().includes(q) ||
        (b.agent       ?? '').toLowerCase().includes(q) ||
        (b.fileHandler ?? '').toLowerCase().includes(q) ||
        b.passengers.some(p => p.name.toLowerCase().includes(q)) ||
        (b.slDriverAllocation?.driver?.name ?? '').toLowerCase().includes(q) ||
        (b.slDriverAllocation?.vendor?.name ?? '').toLowerCase().includes(q) ||
        (effectiveDriver(b)?.name ?? '').toLowerCase().includes(q)
      )
    }

    // Status
    if (statusFilter !== 'all') {
      list = list.filter(b => allocationStatus(b) === statusFilter)
    }

    // Vehicle
    if (vehicleFilter) {
      list = list.filter(b => effectiveVehicleType(b) === vehicleFilter)
    }

    // Date range
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null
      const to   = dateTo   ? new Date(dateTo   + 'T23:59:59') : null
      list = list.filter(b => {
        const d = new Date(b[dateField])
        if (from && d < from) return false
        if (to   && d > to  ) return false
        return true
      })
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === 'pendingFirst') {
        // Hotel Only files sort last — they need no driver, so they are the
        // least urgent thing on a board sorted by outstanding work.
        const order: Record<AllocStatus, number> =
          { pending: 0, emergency: 1, vendor: 2, assigned: 3, hotel_only: 4 }
        const diff = order[allocationStatus(a)] - order[allocationStatus(b)]
        if (diff !== 0) return diff
        return new Date(a.arrivalDate).getTime() - new Date(b.arrivalDate).getTime()
      }
      if (sortBy === 'agent') {
        return (sortDir === 'asc' ? 1 : -1) * ((a.agent ?? '').localeCompare(b.agent ?? ''))
      }
      if (sortBy === 'isNumber') {
        return (sortDir === 'asc' ? 1 : -1) * ((a.isNumber ?? a.bookingRef).localeCompare(b.isNumber ?? b.bookingRef))
      }
      const aVal = new Date(a[sortBy as 'arrivalDate' | 'departureDate' | 'createdAt']).getTime()
      const bVal = new Date(b[sortBy as 'arrivalDate' | 'departureDate' | 'createdAt']).getTime()
      return (sortDir === 'asc' ? 1 : -1) * (aVal - bVal)
    })

    return list
  }, [bookings, activeOnly, search, statusFilter, vehicleFilter, dateFrom, dateTo, dateField, sortBy, sortDir])

  // ── Driver advance loader ─────────────────────────────────────────────────
  //
  // Only what is on screen, and only once. Each accounts-side lookup rebuilds a
  // booking's whole payable position, so asking about every Sri Lanka booking
  // the moment the page opens would put minutes of work on a live system for
  // figures nobody is looking at. The board asks about the rows it is showing,
  // in the order it is showing them, and remembers what it has asked.
  //
  // Chunks go out one after another rather than all at once, and each is
  // merged as it lands, so the column fills top-down while the rest is still
  // being derived.

  const advanceRefs = useMemo(
    () => displayBookings.map(advanceRefFor).filter((r): r is string => Boolean(r)),
    [displayBookings],
  )

  const loadAdvances = useCallback(async (refs: string[], run: number) => {
    if (refs.length === 0) return

    advanceInFlight.current += 1
    setAdvancesLoading(true)
    try {
      for (let i = 0; i < refs.length; i += ADVANCE_CHUNK) {
        // A newer run (a refresh, or a filter that scrolled a different set into
        // view) has taken over — stop rather than write stale figures over it.
        if (advanceRun.current !== run) return

        const chunk = refs.slice(i, i + ADVANCE_CHUNK)

        const res = await fetch('/api/srilanka/driver-advance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ references: chunk }),
        })

        if (!res.ok) throw new Error(`Driver advance lookup failed (${res.status})`)

        const json = await res.json()
        const batch: DriverAdvanceSummary[] = json.data?.advances ?? []

        if (advanceRun.current !== run) return

        setAdvances(prev => {
          const next = { ...prev }
          for (const a of batch) next[a.reference] = a
          return next
        })

        // One notice for the whole board, not one toast per booking: if the
        // accounts system is down, every row says the same thing and the board
        // should say it once, quietly, in the column header.
        const down = batch.find(a => a.state === 'unavailable')
        setAdvanceNotice(down?.message ?? null)
      }
    } catch (err) {
      if (advanceRun.current !== run) return
      console.error('[driver advance]', err)
      setAdvanceNotice('Driver advances could not be read from the accounts system.')
      // The references stay marked as asked; the Refresh button is the retry.
    } finally {
      advanceInFlight.current = Math.max(0, advanceInFlight.current - 1)
      if (advanceInFlight.current === 0) setAdvancesLoading(false)
    }
  }, [])

  useEffect(() => {
    const pending = advanceRefs.filter(r => !askedRefs.current.has(r))
    if (pending.length === 0) return

    for (const r of pending) askedRefs.current.add(r)
    void loadAdvances(pending, advanceRun.current)
  }, [advanceRefs, loadAdvances])

  /** Drop every cached figure and read them again — what Refresh does. */
  const refreshAdvances = useCallback(() => {
    advanceRun.current += 1
    askedRefs.current.clear()
    setAdvances({})
    setAdvanceNotice(null)
  }, [])

  // ── Active filter count ───────────────────────────────────────────────────

  const activeFilters = useMemo(() => {
    let n = 0
    if (search.trim())          n++
    if (statusFilter !== 'all') n++
    if (vehicleFilter)          n++
    if (dateFrom || dateTo)     n++
    if (!activeOnly)            n++   // counts only when showing ALL (non-default)
    return n
  }, [search, statusFilter, vehicleFilter, dateFrom, dateTo, activeOnly])

  function clearAllFilters() {
    setSearch(''); setStatusFilter('all'); setVehicleFilter('')
    setDateFrom(''); setDateTo(''); setDateField('arrivalDate')
    setSortBy('arrivalDate'); setSortDir('asc')
    setActiveOnly(true)
  }

  // ── Quick date presets ────────────────────────────────────────────────────

  function applyPreset(preset: 'today' | 'week' | 'month' | 'next7' | 'next30') {
    const today = todayISO()
    if (preset === 'today')  { setDateFrom(today);          setDateTo(today) }
    if (preset === 'week')   { setDateFrom(startOfWeek());  setDateTo(endOfWeek()) }
    if (preset === 'month')  { setDateFrom(startOfMonth()); setDateTo(endOfMonth()) }
    if (preset === 'next7')  { setDateFrom(today);          setDateTo(addDays(today, 7)) }
    if (preset === 'next30') { setDateFrom(today);          setDateTo(addDays(today, 30)) }
  }

  // ── Stats (from full dataset) ─────────────────────────────────────────────

  const stats = useMemo(() => ({
    total:     bookings.length,
    assigned:  bookings.filter(b => allocationStatus(b) === 'assigned').length,
    vendor:    bookings.filter(b => allocationStatus(b) === 'vendor').length,
    hotelOnly: bookings.filter(b => allocationStatus(b) === 'hotel_only').length,
    pending:   bookings.filter(b => allocationStatus(b) === 'pending').length,
    emergency: bookings.filter(b => allocationStatus(b) === 'emergency').length,
  }), [bookings])

  // ── Vehicle type update ───────────────────────────────────────────────────

  async function handleVehicleChange(booking: SLBooking, vehicleType: VehicleType | null) {
    const prev = bookings
    setBookings(bs => bs.map(b => b.id === booking.id ? { ...b, slDriverAllocation: { ...(b.slDriverAllocation ?? { id: '', driverId: null, vendorId: null, notes: null, isEmergency: false, changeReason: null, changedAt: null, driver: null, vendor: null }), vehicleType } } : b))
    try {
      const res = await fetch('/api/srilanka/driver-allocation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, vehicleType, driverId: booking.slDriverAllocation?.driverId ?? null, vendorId: booking.slDriverAllocation?.vendorId ?? null, notes: booking.slDriverAllocation?.notes ?? null, isEmergency: booking.slDriverAllocation?.isEmergency ?? false, changeReason: booking.slDriverAllocation?.changeReason ?? null }),
      })
      if (!res.ok) throw new Error('Save failed')

      // Switching in or out of Hotel Only rewrites the movement chart server-side
      // (every movement marked / unmarked, drivers released). Re-read so the board
      // shows the same picture the chart now holds rather than a stale one.
      const hotelOnlyChanged =
        (vehicleType === HOTEL_ONLY_VEHICLE) !==
        (booking.slDriverAllocation?.vehicleType === HOTEL_ONLY_VEHICLE)
      if (hotelOnlyChanged) await fetchBookings(true)

      toast.success(vehicleType === HOTEL_ONLY_VEHICLE
        ? 'Hotel Only — no driver required for this booking'
        : 'Vehicle type updated')
    } catch { setBookings(prev); toast.error('Failed to update vehicle type') }
  }

  // ── Driver assign ─────────────────────────────────────────────────────────

  async function handleDriverSave(data: { bookingId: string; driverId?: string | null; vendorId?: string | null; notes?: string; isEmergency?: boolean; changeReason?: string }) {
    const res = await fetch('/api/srilanka/driver-allocation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, vehicleType: bookings.find(b => b.id === data.bookingId)?.slDriverAllocation?.vehicleType ?? null }),
    })
    if (!res.ok) { toast.error('Failed to assign driver'); throw new Error('Failed') }
    const result = await res.json()
    const allocation = result.data ?? result
    setBookings(bs => bs.map(b => b.id === data.bookingId ? { ...b, slDriverAllocation: allocation } : b))
    toast.success(data.driverId ? 'Driver assigned' : 'Vendor assigned')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#060a14] text-white">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[400px] bg-yellow-600/4 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[400px] bg-teal-800/4 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-[1600px] mx-auto px-6 py-8 space-y-5">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 border border-yellow-500/25 flex items-center justify-center shadow-lg shadow-yellow-500/10">
              <CountryFlag country="SRILANKA" className="w-9 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-black text-white tracking-tight">Driver Allocation</h1>
                <span className="px-2.5 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/25 text-yellow-400 text-[10px] font-bold uppercase tracking-wider">Sri Lanka</span>
              </div>
              <p className="text-slate-400 text-sm">
                {displayBookings.length !== bookings.length
                  ? <><span className="text-white font-semibold">{displayBookings.length}</span> of {bookings.length} bookings</>
                  : <><span className="text-white font-semibold">{bookings.length}</span> total Sri Lanka bookings</>
                }
                {activeOnly && <> · <span className="text-teal-400 font-medium">active departures only</span></>}
                {sortBy !== 'arrivalDate' && <> · sorted by <span className="text-yellow-400">{SORT_OPTIONS.find(s => s.value === sortBy)?.label}</span></>}
              </p>
            </div>
          </div>
          {/* Active-only toggle */}
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/40">
            <div className="flex items-center gap-2">
              {activeOnly
                ? <Eye    className="w-3.5 h-3.5 text-teal-400" />
                : <EyeOff className="w-3.5 h-3.5 text-slate-500" />
              }
              <span className={cn('text-xs font-semibold whitespace-nowrap', activeOnly ? 'text-teal-300' : 'text-slate-500')}>
                {activeOnly ? 'Active Only' : 'All Bookings'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveOnly(v => !v)}
              className={cn(
                'relative w-10 h-5 rounded-full transition-colors flex-shrink-0',
                activeOnly ? 'bg-teal-500' : 'bg-slate-700',
              )}
              title={activeOnly ? 'Showing active bookings only — click to show all' : 'Showing all bookings — click to hide past departures'}
            >
              <span className={cn(
                'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform',
                activeOnly ? 'translate-x-5' : 'translate-x-0.5',
              )} />
            </button>
          </div>

          {/* Refresh re-reads the advances too — a payment released in Payable
              1.0 a moment ago should show here without a page reload, and this
              is also the retry path when the accounts system was unreachable. */}
          <button onClick={() => { refreshAdvances(); void fetchBookings(true) }} disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/40 text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-sm font-medium"
          ><RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />Refresh</button>
        </div>

        {/* ── Clickable Stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Bookings"  value={stats.total}     color="border-slate-700/40 text-slate-300"    icon={FileText}      onClick={() => setStatusFilter('all')}       active={statusFilter === 'all'} />
          <StatCard label="Driver Assigned" value={stats.assigned}  color="border-emerald-500/30 text-emerald-400" icon={UserCheck}     onClick={() => setStatusFilter('assigned')}  active={statusFilter === 'assigned'} />
          <StatCard label="Vendor Assigned" value={stats.vendor}    color="border-blue-500/30 text-blue-400"       icon={Truck}         onClick={() => setStatusFilter('vendor')}    active={statusFilter === 'vendor'} />
          <StatCard label="Hotel Only"      value={stats.hotelOnly} color="border-pink-500/30 text-pink-400"       icon={Building2}     onClick={() => setStatusFilter('hotel_only')} active={statusFilter === 'hotel_only'} />
          <StatCard label="Pending"         value={stats.pending}   color="border-amber-500/30 text-amber-400"     icon={Clock}         onClick={() => setStatusFilter('pending')}   active={statusFilter === 'pending'} />
          <StatCard label="Emergency"       value={stats.emergency} color="border-red-500/30 text-red-400"         icon={AlertTriangle} onClick={() => setStatusFilter('emergency')} active={statusFilter === 'emergency'} />
        </div>

        {/* ── Filter Panel ── */}
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-4 space-y-3">

          {/* Row 1: Search + active badge + clear */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search IS#, CNTL, booking ref, client, agent, file handler, driver…"
                className="w-full pl-9 pr-9 py-2.5 bg-slate-800/60 border border-slate-700/40 rounded-xl text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600/20"
              />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>}
            </div>
            {activeFilters > 0 && (
              <button onClick={clearAllFilters}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-700/50 border border-slate-600/40 text-slate-300 hover:text-white hover:bg-slate-700 transition-all text-xs font-semibold whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" />
                Clear all
                <span className="px-1.5 py-0.5 rounded-full bg-brand-500/20 border border-brand-500/30 text-brand-400 text-[10px] font-black">{activeFilters}</span>
              </button>
            )}
          </div>

          {/* Row 2: Date range */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Date</span>
            </div>

            {/* Date field selector */}
            <select value={dateField} onChange={e => setDateField(e.target.value as DateField)}
              className="px-3 py-2 bg-slate-800/60 border border-slate-700/40 rounded-lg text-slate-300 text-xs font-semibold focus:outline-none focus:border-slate-600 cursor-pointer"
            >
              {DATE_FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* From */}
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2 bg-slate-800/60 border border-slate-700/40 rounded-lg text-slate-300 text-xs focus:outline-none focus:border-slate-600 cursor-pointer [color-scheme:dark]"
            />
            <span className="text-slate-600 text-xs">→</span>
            {/* To */}
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2 bg-slate-800/60 border border-slate-700/40 rounded-lg text-slate-300 text-xs focus:outline-none focus:border-slate-600 cursor-pointer [color-scheme:dark]"
            />

            {/* Quick presets */}
            <div className="flex items-center gap-1">
              {([
                { id: 'today',  label: 'Today' },
                { id: 'week',   label: 'This Week' },
                { id: 'month',  label: 'This Month' },
                { id: 'next7',  label: 'Next 7d' },
                { id: 'next30', label: 'Next 30d' },
              ] as const).map(p => (
                <button key={p.id} onClick={() => applyPreset(p.id)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/30 text-slate-500 hover:text-white hover:bg-slate-700/60 hover:border-slate-600/50 transition-all text-[11px] font-semibold"
                >{p.label}</button>
              ))}
            </div>

            {/* Clear date */}
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo('') }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-500/5 border border-transparent hover:border-red-500/20 transition-all text-[11px] font-semibold"
              ><X className="w-3 h-3" />Clear dates</button>
            )}
          </div>

          {/* Row 3: Status + Vehicle + Sort */}
          <div className="flex flex-wrap items-center gap-2">

            {/* Status pills */}
            <div className="flex items-center gap-1 bg-slate-800/40 border border-slate-700/30 rounded-xl p-1">
              {STATUS_OPTIONS.map(s => (
                <button key={s.value} onClick={() => setStatusFilter(s.value)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap',
                    statusFilter === s.value ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300')}
                >{s.short}</button>
              ))}
            </div>

            <div className="h-5 w-px bg-slate-700/50" />

            {/* Vehicle dropdown */}
            <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}
              className="px-3 py-2 bg-slate-800/60 border border-slate-700/40 rounded-xl text-xs font-semibold text-slate-300 focus:outline-none focus:border-slate-600 cursor-pointer"
            >
              <option value="">All Vehicles</option>
              {VEHICLE_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.icon} {v.label}</option>)}
            </select>

            <div className="h-5 w-px bg-slate-700/50" />

            {/* Sort by */}
            <div className="flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <select value={sortBy} onChange={e => setSortBy(e.target.value as SortField)}
                className="px-3 py-2 bg-slate-800/60 border border-slate-700/40 rounded-xl text-xs font-semibold text-slate-300 focus:outline-none focus:border-slate-600 cursor-pointer"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Sort direction — hidden when pendingFirst */}
            {sortBy !== 'pendingFirst' && (
              <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all',
                  'bg-slate-800/60 border-slate-700/40 text-slate-300 hover:text-white hover:bg-slate-700/60')}
              >
                {sortDir === 'asc'
                  ? <><ArrowUp className="w-3.5 h-3.5" />Asc</>
                  : <><ArrowDown className="w-3.5 h-3.5" />Desc</>
                }
              </button>
            )}

            {/* Result count */}
            {displayBookings.length !== bookings.length && (
              <span className="ml-auto text-xs text-slate-500">
                Showing <span className="text-white font-semibold">{displayBookings.length}</span> of {bookings.length}
              </span>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl overflow-hidden shadow-xl shadow-black/20">
          {loading ? (
            <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 text-slate-600 animate-spin" /></div>
          ) : displayBookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700/40 flex items-center justify-center mb-4"><Car className="w-7 h-7 text-slate-600" /></div>
              <p className="text-slate-400 text-base font-semibold">{bookings.length === 0 ? 'No Sri Lanka bookings found' : 'No results match your filters'}</p>
              <p className="text-slate-600 text-sm mt-1">{activeFilters > 0 ? <button onClick={clearAllFilters} className="text-brand-400 underline underline-offset-2">Clear all filters</button> : 'Check back later'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800/60">
                    {[
                      { key: 'isNumber',      label: 'IS # / CNTL',   sortable: true,  field: 'isNumber'      as SortField },
                      { key: 'client',        label: 'Client',         sortable: false, field: null },
                      { key: 'fileHandler',   label: 'File Handler',   sortable: false, field: null },
                      { key: 'agent',         label: 'Agent',          sortable: true,  field: 'agent'         as SortField },
                      { key: 'arrivalDate',   label: 'Arrival',        sortable: true,  field: 'arrivalDate'   as SortField },
                      { key: 'departureDate', label: 'Departure',      sortable: true,  field: 'departureDate' as SortField },
                      { key: 'vehicle',       label: 'Vehicle',        sortable: false, field: null },
                      { key: 'driver',        label: 'Driver / Vendor',sortable: false, field: null },
                      { key: 'advance',       label: 'Driver Advance', sortable: false, field: null },
                      { key: 'status',        label: 'Status',         sortable: false, field: null },
                    ].map(col => (
                      <th key={col.key}
                        onClick={col.sortable && col.field ? () => { if (sortBy === col.field) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(col.field!); setSortDir('asc') } } : undefined}
                        className={cn('px-4 py-3.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap select-none',
                          col.sortable && 'hover:text-slate-400 cursor-pointer group')}
                      >
                        <span className="flex items-center gap-1">
                          {col.label}
                          {/* The advance column fills in behind the board, so it
                              carries its own progress and its own bad news
                              rather than interrupting the page with a toast. */}
                          {col.key === 'advance' && advancesLoading && (
                            <Loader2 className="w-3 h-3 animate-spin text-slate-600" />
                          )}
                          {col.key === 'advance' && !advancesLoading && advanceNotice && (
                            <AlertTriangle className="w-3 h-3 text-amber-500/70" aria-label={advanceNotice} />
                          )}
                          {col.sortable && col.field && (
                            sortBy === col.field
                              ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-yellow-400" /> : <ArrowDown className="w-3 h-3 text-yellow-400" />)
                              : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {displayBookings.map((b, i) => {
                    const status    = allocationStatus(b)
                    const driver    = effectiveDriver(b)
                    const arrFlight = b.flights[0] ?? null
                    const depFlight = b.flights.at(-1) ?? null
                    const leadPax   = b.passengers[0] ?? null
                    const advanceRef = advanceRefFor(b)
                    return (
                      <tr key={b.id} className={cn('transition-colors group',
                        i % 2 === 0 ? 'bg-transparent' : 'bg-slate-900/30',
                        status === 'emergency' && 'bg-red-500/3',
                        status === 'assigned'  && 'bg-emerald-500/2')}>

                        {/* IS # / CNTL */}
                        <td className="px-4 py-3.5">
                          <button onClick={() => setDetailBooking(b)} className="flex items-center gap-1.5 group/ref">
                            <span className="font-black text-yellow-400 hover:text-yellow-300 transition-colors font-mono text-xs">{b.isNumber ?? b.bookingRef}</span>
                            <ChevronRight className="w-3 h-3 text-yellow-600 opacity-0 group-hover/ref:opacity-100 group-hover/ref:text-yellow-400 transition-all" />
                          </button>
                          {b.cntlNumber && (
                            <p className="text-slate-400 text-[10px] mt-0.5 font-mono">{b.cntlNumber}</p>
                          )}
                        </td>

                        {/* Client */}
                        <td className="px-4 py-3.5">
                          {leadPax ? <div><p className="text-white font-semibold text-xs leading-tight">{leadPax.name}</p>{(leadPax.contact ?? b.contactPhone) && <p className="text-slate-500 text-[11px] mt-0.5 flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{leadPax.contact ?? b.contactPhone}</p>}</div> : <span className="text-slate-600 text-xs">—</span>}
                          <div className="flex items-center gap-1 mt-1"><Users className="w-2.5 h-2.5 text-slate-600" /><span className="text-slate-600 text-[10px]">{b.paxAdults}A{b.paxChildren > 0 ? ` ${b.paxChildren}C` : ''}</span></div>
                        </td>

                        {/* File Handler */}
                        <td className="px-4 py-3.5"><span className="text-slate-300 text-xs">{b.fileHandler ?? '—'}</span></td>

                        {/* Agent */}
                        <td className="px-4 py-3.5"><p className="text-slate-300 text-xs">{b.agent ?? '—'}</p>{b.agentPhone && <p className="text-slate-600 text-[10px] mt-0.5">{b.agentPhone}</p>}</td>

                        {/* Arrival */}
                        <td className="px-4 py-3.5">
                          <p className="text-white font-semibold text-xs">{fmt(b.arrivalDate)}</p>
                          {arrFlight && <div className="mt-1 space-y-0.5"><p className="text-slate-500 text-[10px] flex items-center gap-1"><Plane className="w-2.5 h-2.5" /><span className="font-mono font-bold text-slate-400">{arrFlight.flightNo}</span></p><p className="text-slate-600 text-[10px]">{formatTime(arrFlight.arrTime)} · {arrFlight.toApt}</p></div>}
                        </td>

                        {/* Departure */}
                        <td className="px-4 py-3.5">
                          <p className="text-white font-semibold text-xs">{fmt(b.departureDate)}</p>
                          {depFlight && depFlight.id !== arrFlight?.id && <div className="mt-1 space-y-0.5"><p className="text-slate-500 text-[10px] flex items-center gap-1"><Plane className="w-2.5 h-2.5 rotate-90" /><span className="font-mono font-bold text-slate-400">{depFlight.flightNo}</span></p><p className="text-slate-600 text-[10px]">{formatTime(depFlight.depTime)} · {depFlight.fromApt}</p></div>}
                        </td>

                        {/* Vehicle */}
                        <td className="px-4 py-3.5">
                          <VehicleSelector current={effectiveVehicleType(b)} onChange={v => handleVehicleChange(b, v)} />
                        </td>

                        {/* Driver / Vendor */}
                        <td className="px-4 py-3.5">
                          {driver ? (
                            <button onClick={() => setAssignBooking(b)} className="group/d flex items-start gap-2 text-left">
                              <div className={cn('w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-black',
                                driver.kind === 'driver'
                                  ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-300'
                                  : 'bg-blue-500/15 border-blue-500/25 text-blue-300')}>
                                {driver.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <p className={cn('font-bold text-xs transition-colors',
                                  driver.kind === 'driver' ? 'text-emerald-300 group-hover/d:text-emerald-200' : 'text-blue-300 group-hover/d:text-blue-200')}>
                                  {driver.name}
                                </p>
                                {driver.phone && <p className="text-slate-500 text-[10px]">{driver.phone}</p>}
                                {driver.plate && <p className="text-slate-600 text-[10px]">{driver.plate}</p>}
                                {/* Set on the Movement Chart, not from this board */}
                                {driver.fromAgenda && <p className="text-slate-600 text-[10px] italic">from movement chart</p>}
                              </div>
                              <Edit2 className="w-3 h-3 text-slate-600 group-hover/d:text-slate-400 mt-1 opacity-0 group-hover/d:opacity-100 transition-all" />
                            </button>
                          ) : status === 'hotel_only' ? (
                            // Nothing to drive on this file — the Assign prompt would
                            // read as outstanding work that does not exist.
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-pink-500/25 bg-pink-500/5 text-pink-400 text-xs font-semibold">
                              <Building2 className="w-3 h-3" />No driver needed
                            </span>
                          ) : (
                            <button onClick={() => setAssignBooking(b)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-700/60 text-slate-500 hover:text-teal-400 hover:border-teal-500/40 hover:bg-teal-500/5 transition-all text-xs font-semibold">
                              <Navigation2 className="w-3 h-3" />Assign
                            </button>
                          )}
                        </td>

                        {/* Driver Advance — from the Apple Accounts system */}
                        <td className="px-4 py-3.5">
                          <DriverAdvanceCell
                            summary={advanceRef ? advances[advanceRef] : undefined}
                            loading={advancesLoading}
                            onOpen={() => setAdvanceBooking(b)}
                          />
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5">
                          <div className="flex flex-col items-start gap-1.5">
                            <span className={cn('px-2.5 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider', STATUS_BADGE[status])}>
                              {STATUS_LABEL[status] ?? status}
                            </span>
                            {status === 'hotel_only' && (
                              <span className="text-pink-400/70 text-[10px]">No driver needed</span>
                            )}
                            {status === 'emergency' && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-slate-700 text-xs text-center">
          {displayBookings.length} booking{displayBookings.length !== 1 ? 's' : ''} shown · One driver per booking · Emergency changes require reason
        </p>
      </div>

      <BookingDetailPanel booking={detailBooking} onClose={() => setDetailBooking(null)} />
      <DriverAssignModal booking={assignBooking} drivers={drivers} vendors={vendors} onClose={() => setAssignBooking(null)} onSave={handleDriverSave} />
      <DriverAdvanceModal booking={advanceBooking} onClose={() => setAdvanceBooking(null)} />
    </div>
  )
}
