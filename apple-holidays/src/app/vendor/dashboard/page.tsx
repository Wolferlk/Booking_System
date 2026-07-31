'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays, MapPin, Loader2, Clock, CheckCircle2, ChevronDown,
  Car, User2, Navigation2, Route,
} from 'lucide-react'
import LogoSpinner from '@/components/shared/logo-spinner'

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
  /** Sri Lanka = one driver + vehicle for the whole tour. Others = per movement. */
  wholeBooking: boolean
  firstDate: string
  lastDate: string
  movements: TripAssignment[]
}

interface DriverOption  { id: string; name: string; phone: string }
interface VehicleOption { id: string; plateNo: string; type: string; brand: string | null; model: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

const FLAG: Record<string, string> = {
  SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬',
  MALAYSIA: '🇲🇾', SINGAPORE_MALAYSIA: '🇸🇬',
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

/** Mirrors the server rule in /api/vendor/trips/[id] — only Sri Lanka is booking-wide. */
function isWholeBookingCountry(operationCountry: string | null, bookingRef: string) {
  const country = operationCountry ?? (bookingRef.toUpperCase().startsWith('IS') ? 'SRILANKA' : null)
  return country === 'SRILANKA'
}

function groupByBooking(assignments: TripAssignment[]): BookingGroup[] {
  const map = new Map<string, BookingGroup>()
  for (const a of assignments) {
    const b   = a.agendaItem.agenda.booking
    const ref = b.bookingRef
    let g = map.get(ref)
    if (!g) {
      g = {
        bookingRef:       ref,
        isNumber:         b.isNumber,
        dealName:         b.dealName,
        paxAdults:        b.paxAdults,
        paxChildren:      b.paxChildren,
        operationCountry: b.operationCountry,
        wholeBooking:     isWholeBookingCountry(b.operationCountry, ref),
        firstDate:        a.agendaItem.date,
        lastDate:         a.agendaItem.date,
        movements:        [],
      }
      map.set(ref, g)
    }
    if (new Date(a.agendaItem.date) < new Date(g.firstDate)) g.firstDate = a.agendaItem.date
    if (new Date(a.agendaItem.date) > new Date(g.lastDate))  g.lastDate  = a.agendaItem.date
    g.movements.push(a)
  }
  const groups = Array.from(map.values())
  groups.forEach(g => g.movements.sort((a, b) =>
    new Date(a.agendaItem.date).getTime() - new Date(b.agendaItem.date).getTime()
  ))
  return groups.sort((a, b) =>
    new Date(a.firstDate).getTime() - new Date(b.firstDate).getTime()
  )
}

// SELECT base class — solid dark bg so text is always readable
const SEL = 'w-full bg-[#0d1628] border border-white/15 rounded-xl py-3 px-3.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/60 appearance-none cursor-pointer'

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black ${accent}`}>{value}</p>
    </div>
  )
}

// ── Driver / Vehicle pickers ──────────────────────────────────────────────────

function DriverSelect({
  value, onChange, drivers, loading, compact,
}: {
  value: string
  onChange: (v: string) => void
  drivers: DriverOption[]
  loading: boolean
  compact?: boolean
}) {
  if (loading) return (
    <div className="flex items-center gap-2 px-3.5 py-3 bg-[#0d1628] border border-white/15 rounded-xl">
      <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />
      <span className="text-slate-500 text-sm">Loading…</span>
    </div>
  )
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={compact ? SEL.replace('py-3', 'py-2.5') : SEL}
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
  )
}

function VehicleSelect({
  value, onChange, vehicles, loading, compact,
}: {
  value: string
  onChange: (v: string) => void
  vehicles: VehicleOption[]
  loading: boolean
  compact?: boolean
}) {
  if (loading) return (
    <div className="flex items-center gap-2 px-3.5 py-3 bg-[#0d1628] border border-white/15 rounded-xl">
      <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />
      <span className="text-slate-500 text-sm">Loading…</span>
    </div>
  )
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={compact ? SEL.replace('py-3', 'py-2.5') : SEL}
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
  )
}

// ── Movement row (per-movement allocation — SG / MY / VN) ─────────────────────

function MovementRow({
  assignment, index, drivers, vehicles, loadingOpts, onSaved,
}: {
  assignment: TripAssignment
  index: number
  drivers: DriverOption[]
  vehicles: VehicleOption[]
  loadingOpts: boolean
  onSaved: (updated: TripAssignment[]) => void
}) {
  const [selDriver,  setSelDriver]  = useState(assignment.driverId ?? '')
  const [selVehicle, setSelVehicle] = useState('')
  const [saving,     setSaving]     = useState(false)
  const m   = assignment.agendaItem
  const svc = svcLabel(m.serviceType)

  // Vehicles arrive after the first render — match the saved plate back to its id
  useEffect(() => {
    if (!assignment.vehiclePlate || selVehicle) return
    const match = vehicles.find(v => v.plateNo === assignment.vehiclePlate)
    if (match) setSelVehicle(match.id)
  }, [vehicles, assignment.vehiclePlate, selVehicle])

  // Until the fleet list arrives selVehicle can't be resolved, so ignore it for dirtiness
  const vehicleDirty = vehicles.length > 0 &&
    (vehicles.find(v => v.id === selVehicle)?.plateNo ?? null) !== assignment.vehiclePlate
  const dirty = selDriver !== (assignment.driverId ?? '') || vehicleDirty

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/vendor/trips/${assignment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: selDriver || null, vehicleId: selVehicle || null }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error ?? 'Failed to save'); return }
      onSaved(data.data.assignments)
      toast.success(`Movement ${index + 1} updated`)
    } finally { setSaving(false) }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-3 space-y-3">
      {/* Movement header */}
      <div className="flex items-start gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-[10px] font-bold text-slate-400">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-slate-200 text-xs font-semibold truncate">{m.location}</p>
          {(m.fromPoint || m.toPoint) && (
            <p className="text-slate-500 text-[10px] truncate">{m.fromPoint ?? '—'} → {m.toPoint ?? '—'}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {svc && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${svc.cls}`}>{svc.label}</span>}
          <span className="text-slate-500 text-[10px]">{fmtShort(m.date)}</span>
        </div>
      </div>

      {/* Per-movement driver + vehicle */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500 flex items-center gap-1.5 font-semibold uppercase tracking-wider">
            <User2 className="w-3 h-3" /> Driver
          </label>
          <DriverSelect value={selDriver} onChange={setSelDriver} drivers={drivers} loading={loadingOpts} compact />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500 flex items-center gap-1.5 font-semibold uppercase tracking-wider">
            <Car className="w-3 h-3" /> Vehicle
          </label>
          <VehicleSelect value={selVehicle} onChange={setSelVehicle} vehicles={vehicles} loading={loadingOpts} compact />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={save}
          disabled={saving || loadingOpts || !dirty}
          className="bg-brand-500 hover:bg-brand-600 text-white rounded-lg px-4 py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          {dirty ? 'Save this movement' : 'Saved'}
        </button>
        {assignment.driver && (
          <span className="text-[11px] text-emerald-300 font-semibold flex items-center gap-1">
            <User2 className="w-3 h-3" />{assignment.driver.name}
          </span>
        )}
        {assignment.vehiclePlate && (
          <span className="text-[11px] text-blue-300 font-mono flex items-center gap-1">
            <Car className="w-3 h-3" />{assignment.vehiclePlate}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Booking Card ──────────────────────────────────────────────────────────────

function BookingCard({
  group,
  onAssignmentsUpdated,
}: {
  group: BookingGroup
  onAssignmentsUpdated: (updated: TripAssignment[]) => void
}) {
  const [open,        setOpen]        = useState(false)
  const [drivers,     setDrivers]     = useState<DriverOption[]>([])
  const [vehicles,    setVehicles]    = useState<VehicleOption[]>([])
  const [loadingOpts, setLoadingOpts] = useState(false)
  const [loaded,      setLoaded]      = useState(false)

  // Booking-wide form state (Sri Lanka only)
  const first = group.movements[0]
  const [selDriver,  setSelDriver]  = useState(first?.driverId ?? '')
  const [selVehicle, setSelVehicle] = useState('')
  const [saving,     setSaving]     = useState(false)

  const movementCount = group.movements.length
  const today   = new Date(new Date().toDateString())
  const isPast  = new Date(group.lastDate) < today

  const assignedCount = group.movements.filter(m => m.driverId || m.vehiclePlate).length

  async function loadOptions() {
    if (loaded) return
    setLoadingOpts(true)
    try {
      const [dr, vh] = await Promise.all([
        fetch('/api/vendor/drivers').then(r => r.json()),
        fetch('/api/vendor/vehicles').then(r => r.json()),
      ])
      if (dr.success) setDrivers(dr.data)
      if (vh.success) {
        setVehicles(vh.data)
        if (group.wholeBooking && first?.vehiclePlate) {
          const match = (vh.data as VehicleOption[]).find(v => v.plateNo === first.vehiclePlate)
          if (match) setSelVehicle(match.id)
        }
      }
      setLoaded(true)
    } finally { setLoadingOpts(false) }
  }

  function toggle() {
    if (!open) loadOptions()
    setOpen(o => !o)
  }

  async function saveWholeBooking() {
    if (!first) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vendor/trips/${first.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: selDriver || null, vehicleId: selVehicle || null }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error ?? 'Failed to save'); return }
      onAssignmentsUpdated(data.data.assignments)
      toast.success(`Driver assigned to all ${movementCount} movement${movementCount !== 1 ? 's' : ''}`)
      setOpen(false)
    } finally { setSaving(false) }
  }

  const selDriverLabel  = drivers.find(d => d.id === selDriver)?.name
  const selVehicleLabel = vehicles.find(v => v.id === selVehicle)?.plateNo ?? first?.vehiclePlate
  const hasAssignment   = assignedCount > 0
  const fullyAssigned   = assignedCount === movementCount

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      isPast ? 'border-white/6 bg-white/2' : fullyAssigned ? 'border-emerald-500/20 bg-white/4' : 'border-white/10 bg-white/4'
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
                {movementCount} movement{movementCount !== 1 ? 's' : ''}
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
          {group.wholeBooking ? (
            <>
              {first?.driver ? (
                <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1">
                  <User2 className="w-3 h-3 text-emerald-400" />
                  <span className="text-xs text-emerald-300 font-semibold">{first.driver.name}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span className="text-xs text-amber-300 font-semibold">No driver</span>
                </div>
              )}
              {first?.vehiclePlate ? (
                <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-1">
                  <Car className="w-3 h-3 text-blue-400" />
                  <span className="text-xs text-blue-300 font-mono">{first.vehiclePlate}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-white/5 border border-white/8 rounded-lg px-2.5 py-1">
                  <Car className="w-3 h-3 text-slate-500" />
                  <span className="text-xs text-slate-500">No vehicle</span>
                </div>
              )}
            </>
          ) : (
            <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 border ${
              fullyAssigned
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : hasAssignment
                  ? 'bg-blue-500/10 border-blue-500/20'
                  : 'bg-amber-500/10 border-amber-500/20'
            }`}>
              {fullyAssigned
                ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                : <Clock className={`w-3 h-3 ${hasAssignment ? 'text-blue-400' : 'text-amber-400'}`} />}
              <span className={`text-xs font-semibold ${
                fullyAssigned ? 'text-emerald-300' : hasAssignment ? 'text-blue-300' : 'text-amber-300'
              }`}>
                {assignedCount} of {movementCount} movement{movementCount !== 1 ? 's' : ''} allocated
              </span>
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/8 bg-black/20">
          {group.wholeBooking ? (
            <>
              {/* ── Sri Lanka: one driver + vehicle for the whole tour ── */}
              <div className="px-4 pt-3 pb-2 space-y-1.5">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Route className="w-3 h-3" />Movements ({movementCount})
                </p>
                {group.movements.slice(0, 5).map(a => {
                  const m   = a.agendaItem
                  const svc = svcLabel(m.serviceType)
                  return (
                    <div key={a.id} className="flex items-center gap-2.5 py-1.5">
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
                {movementCount > 5 && (
                  <p className="text-slate-600 text-[11px] pl-8">+{movementCount - 5} more movements</p>
                )}
              </div>

              <div className="px-4 pb-4 pt-2 space-y-3 border-t border-white/6 mt-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Navigation2 className="w-3 h-3" />
                  Assign Driver &amp; Vehicle
                  <span className="text-slate-600 font-normal normal-case tracking-normal">
                    — applies to all {movementCount} movements
                  </span>
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500 flex items-center gap-1.5 font-semibold">
                    <User2 className="w-3 h-3" /> Driver
                  </label>
                  <DriverSelect value={selDriver} onChange={setSelDriver} drivers={drivers} loading={loadingOpts} />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500 flex items-center gap-1.5 font-semibold">
                    <Car className="w-3 h-3" /> Vehicle
                  </label>
                  <VehicleSelect value={selVehicle} onChange={setSelVehicle} vehicles={vehicles} loading={loadingOpts} />
                </div>

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
                  onClick={saveWholeBooking}
                  disabled={saving || loadingOpts}
                  className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm Assignment
                </button>
              </div>
            </>
          ) : (
            /* ── SG / MY / VN: a driver + vehicle per movement ── */
            <div className="px-4 py-4 space-y-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Navigation2 className="w-3 h-3" />
                Allocate per movement
                <span className="text-slate-600 font-normal normal-case tracking-normal">
                  — each movement can have its own driver &amp; vehicle
                </span>
              </p>
              {group.movements.map((a, i) => (
                <MovementRow
                  key={a.id}
                  assignment={a}
                  index={i}
                  drivers={drivers}
                  vehicles={vehicles}
                  loadingOpts={loadingOpts}
                  onSaved={onAssignmentsUpdated}
                />
              ))}
            </div>
          )}
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

  /** Merge the assignment rows the API echoed back into local state. */
  function handleAssignmentsUpdated(updated: TripAssignment[]) {
    if (!updated?.length) return
    const byId = new Map(updated.map(u => [u.id, u]))
    setAssignments(prev =>
      prev.map(a => {
        const u = byId.get(a.id)
        return u
          ? { ...a, driverId: u.driverId, driverName: u.driverName,
              vehiclePlate: u.vehiclePlate, vehicleType: u.vehicleType,
              notes: u.notes, driver: u.driver }
          : a
      })
    )
  }

  if (loading) return (
    <div className="flex justify-center items-center py-32">
      <LogoSpinner size={48} />
    </div>
  )

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 space-y-6">
      <div className="pt-1 sm:pt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-white font-black text-2xl sm:text-3xl">Assigned Bookings</h1>
          <p className="text-slate-500 text-sm mt-1">
            Each card is one booking. Sri Lanka tours take one driver and vehicle for the whole tour —
            every other country is allocated movement by movement.
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
                  <BookingCard key={g.bookingRef} group={g} onAssignmentsUpdated={handleAssignmentsUpdated} />
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
                  <BookingCard key={g.bookingRef} group={g} onAssignmentsUpdated={handleAssignmentsUpdated} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
