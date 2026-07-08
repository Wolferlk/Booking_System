'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays, MapPin, Loader2, Clock, CheckCircle2, ChevronDown,
  Car, User2, Navigation2, Route,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface TripAssignment {
  id: string
  driverId: string | null
  driverName: string | null
  vehiclePlate: string | null
  vehicleType: string | null
  notes: string | null
  driver: { id: string; name: string; phone: string; photoUrl: string | null } | null
  agendaItem: {
    id: string
    date: string
    location: string
    fromPoint: string | null
    toPoint: string | null
    serviceType: string | null
    meetingTime: string | null
    timeFrom: string | null
    timeTo: string | null
    agenda: {
      bookingId: string
      booking: {
        bookingRef: string
        isNumber: string | null
        dealName: string | null
        paxAdults: number
        paxChildren: number
        operationCountry: string | null
      }
    }
  }
}

interface BookingGroup {
  bookingRef: string
  isNumber: string | null
  dealName: string | null
  paxAdults: number
  paxChildren: number
  operationCountry: string | null
  firstAssignmentId: string
  driverId: string | null
  driverName: string | null
  vehiclePlate: string | null
  vehicleType: string | null
  driver: TripAssignment['driver']
  firstDate: string
  lastDate: string
  movementCount: number
  movements: {
    date: string
    location: string
    fromPoint: string | null
    toPoint: string | null
    serviceType: string | null
    meetingTime: string | null
  }[]
}

interface DriverOption  { id: string; name: string; phone: string }
interface VehicleOption { id: string; plateNo: string; type: string; brand: string | null; model: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

const FLAG: Record<string, string> = {
  SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬',
  MALAYSIA: '🇲🇾', SINGAPORE_MALAYSIA: '🇸🇬',
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtShort(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
function fmtDay(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short' })
}
function svcLabel(t: string | null) {
  if (t === 'PVT_TRANSFER')   return { label: 'Private Transfer', cls: 'bg-blue-500/15 border-blue-500/25 text-blue-300' }
  if (t === 'SIC_TRANSFER')   return { label: 'SIC Transfer',     cls: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-300' }
  if (t === 'OWN_ARRANGEMENT') return { label: 'Own Arrangement', cls: 'bg-slate-500/15 border-slate-500/25 text-slate-400' }
  if (t === 'INTERNAL_TOUR')  return { label: 'Internal Tour',    cls: 'bg-purple-500/15 border-purple-500/25 text-purple-300' }
  return null
}

function groupByBooking(assignments: TripAssignment[]): BookingGroup[] {
  const map = new Map<string, BookingGroup>()
  for (const a of assignments) {
    const ref = a.agendaItem.agenda.booking.bookingRef
    if (!map.has(ref)) {
      map.set(ref, {
        bookingRef:        ref,
        isNumber:          a.agendaItem.agenda.booking.isNumber,
        dealName:          a.agendaItem.agenda.booking.dealName,
        paxAdults:         a.agendaItem.agenda.booking.paxAdults,
        paxChildren:       a.agendaItem.agenda.booking.paxChildren,
        operationCountry:  a.agendaItem.agenda.booking.operationCountry,
        firstAssignmentId: a.id,
        driverId:          a.driverId,
        driverName:        a.driverName,
        vehiclePlate:      a.vehiclePlate,
        vehicleType:       a.vehicleType,
        driver:            a.driver,
        firstDate:         a.agendaItem.date,
        lastDate:          a.agendaItem.date,
        movementCount:     1,
        movements: [{
          date:        a.agendaItem.date,
          location:    a.agendaItem.location,
          fromPoint:   a.agendaItem.fromPoint,
          toPoint:     a.agendaItem.toPoint,
          serviceType: a.agendaItem.serviceType,
          meetingTime: a.agendaItem.meetingTime,
        }],
      })
    } else {
      const g = map.get(ref)!
      g.movementCount++
      if (new Date(a.agendaItem.date) < new Date(g.firstDate)) g.firstDate = a.agendaItem.date
      if (new Date(a.agendaItem.date) > new Date(g.lastDate))  g.lastDate  = a.agendaItem.date
      g.movements.push({
        date:        a.agendaItem.date,
        location:    a.agendaItem.location,
        fromPoint:   a.agendaItem.fromPoint,
        toPoint:     a.agendaItem.toPoint,
        serviceType: a.agendaItem.serviceType,
        meetingTime: a.agendaItem.meetingTime,
      })
    }
  }
  return [...map.values()].sort((a, b) =>
    new Date(a.firstDate).getTime() - new Date(b.firstDate).getTime()
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black ${accent}`}>{value}</p>
    </div>
  )
}

// ── Booking Card ──────────────────────────────────────────────────────────────

function BookingCard({
  group,
  onUpdate,
}: {
  group: BookingGroup
  onUpdate: (ref: string, patch: Partial<BookingGroup>) => void
}) {
  const [open,      setOpen]      = useState(false)
  const [drivers,   setDrivers]   = useState<DriverOption[]>([])
  const [vehicles,  setVehicles]  = useState<VehicleOption[]>([])
  const [selDriver, setSelDriver] = useState(group.driverId ?? '')
  const [selVehicle,setSelVehicle]= useState('')
  const [saving,    setSaving]    = useState(false)
  const [loadingOpts, setLoadingOpts] = useState(false)

  const today   = new Date(new Date().toDateString())
  const isPast  = new Date(group.lastDate) < today

  async function loadOptions() {
    if (drivers.length) return
    setLoadingOpts(true)
    try {
      const [dr, vh] = await Promise.all([
        fetch('/api/vendor/drivers').then(r => r.json()),
        fetch('/api/vendor/vehicles').then(r => r.json()),
      ])
      if (dr.success) setDrivers(dr.data)
      if (vh.success) {
        setVehicles(vh.data)
        if (group.vehiclePlate) {
          const match = (vh.data as VehicleOption[]).find(v => v.plateNo === group.vehiclePlate)
          if (match) setSelVehicle(match.id)
        }
      }
    } finally { setLoadingOpts(false) }
  }

  function toggle() {
    if (!open) loadOptions()
    setOpen(o => !o)
  }

  async function save() {
    setSaving(true)
    try {
      const res  = await fetch(`/api/vendor/trips/${group.firstAssignmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId:  selDriver  || null,
          vehicleId: selVehicle || null,
        }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error ?? 'Failed to save'); return }
      const d = data.data
      onUpdate(group.bookingRef, {
        driverId:    d.driverId,
        driverName:  d.driverName,
        vehiclePlate:d.vehiclePlate,
        vehicleType: d.vehicleType,
        driver:      d.driver,
      })
      toast.success(`Driver assigned to all ${group.movementCount} movement${group.movementCount !== 1 ? 's' : ''}`)
      setOpen(false)
    } finally { setSaving(false) }
  }

  const selDriverLabel  = drivers.find(d => d.id === selDriver)?.name
  const selVehicleLabel = vehicles.find(v => v.id === selVehicle)?.plateNo ?? group.vehiclePlate
  const hasAssignment   = !!(group.driverId || group.vehiclePlate)

  // SELECT base class — solid dark bg so text is always readable
  const SEL = 'w-full bg-[#0d1628] border border-white/15 rounded-xl py-3 px-3.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/60 appearance-none cursor-pointer'

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      isPast ? 'border-white/6 bg-white/2' : hasAssignment ? 'border-emerald-500/20 bg-white/4' : 'border-white/10 bg-white/4'
    }`}>
      <button onClick={toggle} className="w-full text-left p-4">
        <div className="flex items-start gap-3">
          {/* Country badge */}
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isPast ? 'bg-slate-700/40' : 'bg-brand-500/15'
          }`}>
            <span className="text-xl">{FLAG[group.operationCountry ?? ''] ?? '📍'}</span>
          </div>

          {/* Main info */}
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{group.dealName ?? group.bookingRef}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {group.isNumber && (
                <span className="text-yellow-400 font-mono text-xs font-bold">{group.isNumber}</span>
              )}
              <span className="text-slate-500 text-xs">{group.bookingRef}</span>
              <span className="text-slate-600 text-xs">·</span>
              <span className="text-slate-500 text-xs">{group.paxAdults + group.paxChildren} pax</span>
            </div>

            {/* Date range + movement count */}
            <div className="flex items-center gap-3 mt-1.5">
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <CalendarDays className="w-3 h-3" />
                {group.firstDate === group.lastDate
                  ? fmtShort(group.firstDate)
                  : `${fmtShort(group.firstDate)} → ${fmtShort(group.lastDate)}`
                }
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Route className="w-3 h-3" />
                {group.movementCount} movement{group.movementCount !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Right: date + chevron */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <p className="text-white text-xs font-bold">{fmtShort(group.firstDate)}</p>
            <p className="text-slate-500 text-[10px]">{fmtDay(group.firstDate)}</p>
            <ChevronDown className={`w-4 h-4 text-slate-600 transition-transform mt-1 ${open ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Assignment status */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {group.driver ? (
            <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1">
              <User2 className="w-3 h-3 text-emerald-400" />
              <span className="text-xs text-emerald-300 font-semibold">{group.driver.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1">
              <Clock className="w-3 h-3 text-amber-400" />
              <span className="text-xs text-amber-300 font-semibold">No driver</span>
            </div>
          )}
          {group.vehiclePlate ? (
            <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-1">
              <Car className="w-3 h-3 text-blue-400" />
              <span className="text-xs text-blue-300 font-mono">{group.vehiclePlate}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/8 rounded-lg px-2.5 py-1">
              <Car className="w-3 h-3 text-slate-500" />
              <span className="text-xs text-slate-500">No vehicle</span>
            </div>
          )}
        </div>
      </button>

      {/* Movements summary (collapsed list inside the card) */}
      {open && (
        <div className="border-t border-white/8 bg-black/20">
          {/* Movements preview */}
          <div className="px-4 pt-3 pb-2 space-y-1.5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Route className="w-3 h-3" />Movements ({group.movementCount})
            </p>
            {group.movements.slice(0, 5).map((m, i) => {
              const svc = svcLabel(m.serviceType)
              return (
                <div key={i} className="flex items-center gap-2.5 py-1.5">
                  <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-3 h-3 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300 text-xs font-semibold truncate">{m.location}</p>
                    {(m.fromPoint || m.toPoint) && (
                      <p className="text-slate-500 text-[10px] truncate">{m.fromPoint ?? '—'} → {m.toPoint ?? '—'}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {svc && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${svc.cls}`}>{svc.label}</span>}
                    <span className="text-slate-600 text-[10px]">{fmtShort(m.date)}</span>
                  </div>
                </div>
              )
            })}
            {group.movementCount > 5 && (
              <p className="text-slate-600 text-[11px] pl-8">+{group.movementCount - 5} more movements</p>
            )}
          </div>

          {/* Assignment form */}
          <div className="px-4 pb-4 pt-2 space-y-3 border-t border-white/6 mt-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Navigation2 className="w-3 h-3" />
              Assign Driver &amp; Vehicle
              <span className="text-slate-600 font-normal normal-case tracking-normal">
                — applies to all {group.movementCount} movements
              </span>
            </p>

            {/* Driver */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-500 flex items-center gap-1.5 font-semibold">
                <User2 className="w-3 h-3" /> Driver
              </label>
              {loadingOpts ? (
                <div className="flex items-center gap-2 px-3.5 py-3 bg-[#0d1628] border border-white/15 rounded-xl">
                  <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                  <span className="text-slate-500 text-sm">Loading…</span>
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={selDriver}
                    onChange={e => setSelDriver(e.target.value)}
                    className={SEL}
                    style={{ colorScheme: 'dark', WebkitAppearance: 'none' }}
                  >
                    <option value="" style={{ background: '#0d1628', color: '#94a3b8' }}>— No driver —</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.id} style={{ background: '#0d1628', color: '#fff' }}>
                        {d.name} · {d.phone}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Vehicle */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-500 flex items-center gap-1.5 font-semibold">
                <Car className="w-3 h-3" /> Vehicle
              </label>
              {loadingOpts ? (
                <div className="flex items-center gap-2 px-3.5 py-3 bg-[#0d1628] border border-white/15 rounded-xl">
                  <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                  <span className="text-slate-500 text-sm">Loading…</span>
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={selVehicle}
                    onChange={e => setSelVehicle(e.target.value)}
                    className={SEL}
                    style={{ colorScheme: 'dark', WebkitAppearance: 'none' }}
                  >
                    <option value="" style={{ background: '#0d1628', color: '#94a3b8' }}>— No vehicle —</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id} style={{ background: '#0d1628', color: '#fff' }}>
                        {v.plateNo}{v.brand ? ` · ${v.brand}${v.model ? ' ' + v.model : ''}` : ` · ${v.type}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Preview */}
            {(selDriverLabel || selVehicleLabel) && (
              <div className="bg-white/4 border border-white/8 rounded-xl px-3.5 py-3 flex items-center gap-3 flex-wrap">
                {selDriverLabel && (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-emerald-300 font-semibold">{selDriverLabel}</span>
                  </div>
                )}
                {selVehicleLabel && (
                  <div className="flex items-center gap-1.5">
                    <Car className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs text-blue-300 font-mono">{selVehicleLabel}</span>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={save}
              disabled={saving || loadingOpts}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm Assignment
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VendorDashboardPage() {
  const [assignments, setAssignments] = useState<TripAssignment[]>([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    fetch('/api/vendor/trips')
      .then(r => r.json())
      .then(d => { if (d.success) setAssignments(d.data) })
      .finally(() => setLoading(false))
  }, [])

  const groups = useMemo(() => groupByBooking(assignments), [assignments])

  const today     = new Date(new Date().toDateString())
  const upcoming  = groups.filter(g => new Date(g.lastDate) >= today)
  const past      = groups.filter(g => new Date(g.lastDate) <  today)

  function handleUpdate(ref: string, patch: Partial<BookingGroup>) {
    setAssignments(prev =>
      prev.map(a =>
        a.agendaItem.agenda.booking.bookingRef === ref
          ? { ...a, ...patch }
          : a
      )
    )
  }

  if (loading) return (
    <div className="flex justify-center items-center py-32">
      <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
    </div>
  )

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 space-y-6">
      <div className="pt-1 sm:pt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-white font-black text-2xl sm:text-3xl">Assigned Bookings</h1>
          <p className="text-slate-500 text-sm mt-1">
            Each card is one booking. Assign a driver and vehicle — it applies to all movements in that booking.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:min-w-[280px]">
          <StatCard label="Total"    value={groups.length}   accent="text-white" />
          <StatCard label="Upcoming" value={upcoming.length} accent="text-brand-300" />
          <StatCard label="Past"     value={past.length}     accent="text-slate-400" />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/4 border border-white/8 flex items-center justify-center mb-4">
            <CalendarDays className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-semibold">No bookings assigned yet</p>
          <p className="text-slate-600 text-sm mt-1">Bookings will appear here once assigned by the ground team</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Upcoming · {upcoming.length}
              </p>
              <div className="space-y-3">
                {upcoming.map(g => (
                  <BookingCard key={g.bookingRef} group={g} onUpdate={handleUpdate} />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Past · {past.length}
              </p>
              <div className="space-y-3 opacity-60">
                {past.slice(0, 10).map(g => (
                  <BookingCard key={g.bookingRef} group={g} onUpdate={handleUpdate} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
