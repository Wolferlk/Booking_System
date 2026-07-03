'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, MapPin, Loader2, Clock, CheckCircle2, ChevronRight, Car, User2 } from 'lucide-react'

interface Trip {
  id: string
  driverId: string | null
  driverName: string | null
  vehiclePlate: string | null
  vehicleType: string | null
  notes: string | null
  driver: { id: string; name: string; phone: string; photoUrl: string | null } | null
  agendaItem: {
    date: string
    location: string
    fromPoint: string | null
    toPoint: string | null
    agenda: {
      booking: {
        bookingRef: string
        dealName: string | null
        paxAdults: number
        paxChildren: number
        operationCountry: string | null
      }
    }
  }
}

interface DriverOption { id: string; name: string; phone: string }
interface VehicleOption { id: string; plateNo: string; type: string; brand: string | null; model: string | null }

const COUNTRY_FLAG: Record<string, string> = {
  SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬', MALAYSIA: '🇲🇾', SINGAPORE_MALAYSIA: '🇸🇬',
}

export default function VendorTripsPage() {
  const [trips, setTrips]     = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/vendor/trips')
      .then(r => r.json())
      .then(d => { if (d.success) setTrips(d.data) })
      .finally(() => setLoading(false))
  }, [])

  const today    = new Date(new Date().toDateString())
  const upcoming = trips.filter(t => new Date(t.agendaItem.date) >= today)
  const past     = trips.filter(t => new Date(t.agendaItem.date) <  today)

  if (loading) return (
    <div className="flex justify-center items-center py-32">
      <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 space-y-6">
      <div className="pt-1 sm:pt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-white font-black text-2xl sm:text-3xl">Assigned Trips</h1>
          <p className="text-slate-500 text-sm mt-1 max-w-2xl">
            Live assignments for your fleet, with quick access to the driver and vehicle details you need for the day.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:min-w-[360px]">
          <StatCard label="Total" value={trips.length} accent="text-white" />
          <StatCard label="Upcoming" value={upcoming.length} accent="text-brand-300" />
          <StatCard label="Past" value={past.length} accent="text-slate-300" />
        </div>
      </div>

      {trips.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
            <CalendarDays className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-semibold">No trips assigned yet</p>
          <p className="text-slate-600 text-sm mt-1">Trips will appear here once assigned by the ground team</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Upcoming</p>
              <div className="space-y-3">
                {upcoming.map(trip => <TripCard key={trip.id} trip={trip} onUpdate={setTrips} />)}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Past</p>
              <div className="space-y-3 opacity-60">
                {past.slice(0, 10).map(trip => <TripCard key={trip.id} trip={trip} onUpdate={setTrips} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black ${accent}`}>{value}</p>
    </div>
  )
}

function TripCard({ trip, onUpdate }: { trip: Trip; onUpdate: React.Dispatch<React.SetStateAction<Trip[]>> }) {
  const [open, setOpen]             = useState(false)
  const [drivers, setDrivers]       = useState<DriverOption[]>([])
  const [vehicles, setVehicles]     = useState<VehicleOption[]>([])
  const [selDriver, setSelDriver]   = useState(trip.driverId ?? '')
  const [selVehicle, setSelVehicle] = useState('')
  const [saving, setSaving]         = useState(false)

  const date  = new Date(trip.agendaItem.date)
  const isPast = date < new Date(new Date().toDateString())
  const b = trip.agendaItem.agenda.booking

  async function loadOptions() {
    const [dr, vh] = await Promise.all([
      fetch('/api/vendor/drivers').then(r => r.json()),
      fetch('/api/vendor/vehicles').then(r => r.json()),
    ])
    if (dr.success) setDrivers(dr.data)
    if (vh.success) {
      setVehicles(vh.data)
      // Pre-select vehicle if trip already has a plate
      if (trip.vehiclePlate) {
        const match = (vh.data as VehicleOption[]).find(v => v.plateNo === trip.vehiclePlate)
        if (match) setSelVehicle(match.id)
      }
    }
  }

  function toggleOpen() {
    if (!open) loadOptions()
    setOpen(o => !o)
  }

  async function save() {
    setSaving(true)
    try {
      const res  = await fetch(`/api/vendor/trips/${trip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId:  selDriver  || null,
          vehicleId: selVehicle || null,
        }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error); return }
      toast.success('Assignment updated')
      onUpdate(prev => prev.map(t => t.id === trip.id ? { ...t, ...data.data, driver: data.data.driver } : t))
      setOpen(false)
    } finally { setSaving(false) }
  }

  const selectedDriverName  = drivers.find(d => d.id === selDriver)?.name
  const selectedVehiclePlate = vehicles.find(v => v.id === selVehicle)?.plateNo ?? trip.vehiclePlate

  return (
    <div className={`rounded-2xl border overflow-hidden ${isPast ? 'border-white/6 bg-white/2' : 'border-white/10 bg-white/4'}`}>
      <button onClick={toggleOpen} className="w-full text-left p-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isPast ? 'bg-slate-700/40' : 'bg-brand-500/15'}`}>
            <span className="text-lg">{COUNTRY_FLAG[b.operationCountry ?? ''] ?? '📍'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{b.dealName ?? b.bookingRef}</p>
            <p className="text-slate-500 text-xs">{b.bookingRef} · {b.paxAdults + b.paxChildren} pax</p>
            <p className="text-brand-400 text-xs mt-1 font-medium truncate">{trip.agendaItem.location}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-white text-xs font-bold">{date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
            <p className="text-slate-500 text-[10px]">{date.toLocaleDateString('en-GB', { weekday: 'short' })}</p>
          </div>
        </div>

        {(trip.agendaItem.fromPoint || trip.agendaItem.toPoint) && (
          <div className="flex items-center gap-1.5 mt-2.5 text-xs text-slate-400">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{trip.agendaItem.fromPoint ?? '—'} → {trip.agendaItem.toPoint ?? '—'}</span>
          </div>
        )}

        {/* Assignment status badges */}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {/* Driver badge */}
          {trip.driver ? (
            <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2 py-1">
              <User2 className="w-3 h-3 text-emerald-400" />
              <span className="text-xs text-emerald-300 font-semibold">{trip.driver.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1">
              <Clock className="w-3 h-3 text-amber-400" />
              <span className="text-xs text-amber-300 font-semibold">No driver</span>
            </div>
          )}
          {/* Vehicle badge */}
          {trip.vehiclePlate ? (
            <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg px-2 py-1">
              <Car className="w-3 h-3 text-blue-400" />
              <span className="text-xs text-blue-300 font-mono">{trip.vehiclePlate}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
              <Car className="w-3 h-3 text-slate-500" />
              <span className="text-xs text-slate-500">No vehicle</span>
            </div>
          )}
          <ChevronRight className={`w-4 h-4 ml-auto transition-transform ${open ? 'rotate-90' : ''} text-slate-600`} />
        </div>
      </button>

      {/* Assignment panel */}
      {open && (
        <div className="border-t border-white/8 bg-black/20 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assign Driver &amp; Vehicle</p>

          {/* Driver selector */}
          <div>
            <label className="text-xs text-slate-500 mb-1.5 flex items-center gap-1">
              <User2 className="w-3 h-3" /> Driver
            </label>
            <select
              value={selDriver}
              onChange={e => setSelDriver(e.target.value)}
              className="w-full bg-white/8 border border-white/12 rounded-xl py-2.5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              style={{ colorScheme: 'dark' }}
            >
              <option value="" style={{ background: '#0d1628' }}>— No driver —</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id} style={{ background: '#0d1628' }}>{d.name} · {d.phone}</option>
              ))}
            </select>
          </div>

          {/* Vehicle selector */}
          <div>
            <label className="text-xs text-slate-500 mb-1.5 flex items-center gap-1">
              <Car className="w-3 h-3" /> Vehicle
            </label>
            <select
              value={selVehicle}
              onChange={e => setSelVehicle(e.target.value)}
              className="w-full bg-white/8 border border-white/12 rounded-xl py-2.5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              style={{ colorScheme: 'dark' }}
            >
              <option value="" style={{ background: '#0d1628' }}>— No vehicle —</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id} style={{ background: '#0d1628' }}>
                  {v.plateNo}{v.brand ? ` · ${v.brand}${v.model ? ' ' + v.model : ''}` : ` · ${v.type}`}
                </option>
              ))}
            </select>
          </div>

          {/* Preview */}
          {(selectedDriverName || selectedVehiclePlate) && (
            <div className="bg-white/4 rounded-xl px-3 py-2.5 flex items-center gap-3">
              {selectedDriverName && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs text-emerald-300 font-semibold">{selectedDriverName}</span>
                </div>
              )}
              {selectedVehiclePlate && (
                <div className="flex items-center gap-1.5">
                  <Car className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs text-blue-300 font-mono">{selectedVehiclePlate}</span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={save}
            disabled={saving}
            className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Confirm Assignment
          </button>
        </div>
      )}
    </div>
  )
}
