'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Trash2, Save, Loader2, Wand2, Car, MapPin, Upload,
  Search, X, CheckCircle2, Phone, AlertTriangle, Users, Plane,
  Hotel, ShieldAlert, ChevronDown, ChevronUp, UsersRound,
  Sparkles, Eye, Mail, CreditCard, Info,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Modal from '@/components/ui/modal'
import { formatDate } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

const SERVICE_TYPES = [
  { value: 'PVT_TRANSFER',    label: 'PVT Transfer',    color: 'blue'  as const },
  { value: 'SIC_TRANSFER',    label: 'SIC Transfer',    color: 'green' as const },
  { value: 'OWN_ARRANGEMENT', label: 'Own Arrangement', color: 'gray'  as const },
]

interface AgendaItem {
  id?: string
  date: string
  location: string
  fromPoint: string
  toPoint: string
  details: string
  mealPlan: string
  meetingTime: string
  serviceType: string
  assignment?: {
    driverId?: string | null
    driverName?: string
    driverPhone?: string
    vehicleType?: string
    vehiclePlate?: string
  } | null
}

interface Driver {
  id: string
  name: string
  phone: string
  isActive: boolean
  isBusyOnDate?: boolean
  busyBookings?: string[]
  vehicle: { plateNo: string; type: string; brand?: string | null; model?: string | null } | null
}

interface FullDriver {
  id: string
  name: string
  phone: string
  email: string | null
  licenseNo: string | null
  photoUrl: string | null
  vehicle: {
    plateNo: string
    type: string
    brand: string | null
    model: string | null
    capacity: number
    description: string | null
    photoOutside: string | null
    photoInside: string | null
  } | null
}

interface BookingDetails {
  bookingRef: string
  agent: string
  paxAdults: number
  paxChildren: number
  arrivalDate: string
  departureDate: string
  passengers: { id: string; name: string; type: string; passport?: string | null; nationality?: string | null; contact?: string | null; isLead?: boolean }[]
  flights: { id: string; flightNo: string; date: string; fromApt: string; depTime?: string | null; toApt: string; arrTime?: string | null; airline?: string | null }[]
  accommodations: { id: string; hotel: string; city: string; checkIn: string; checkOut: string; nights: number; roomType?: string | null; mealType?: string | null }[]
  emergencyContacts: { id: string; name: string; phone?: string | null; role?: string | null }[]
}

export default function AgendaPage() {
  const { ref } = useParams<{ ref: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [items,          setItems]          = useState<AgendaItem[]>([])
  const [booking,        setBooking]        = useState<BookingDetails | null>(null)
  const [drivers,        setDrivers]        = useState<Driver[]>([])
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [generating,     setGenerating]     = useState(false)
  const [showUpload,     setShowUpload]     = useState(false)
  const [assigningIdx,   setAssigningIdx]   = useState<number | null>(null)
  const [driverSearch,   setDriverSearch]   = useState('')
  const [loadingDrivers, setLoadingDrivers] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>('passengers')
  // Per-item expandable details (read mode)
  const [expandedDetails, setExpandedDetails] = useState<Set<number>>(new Set())
  // Per-item AI describe loading
  const [describingIdx,  setDescribingIdx]  = useState<number | null>(null)
  // Driver view modal
  const [driverModal,    setDriverModal]    = useState(false)
  const [fullDriver,     setFullDriver]     = useState<FullDriver | null>(null)
  const [loadingDriver,  setLoadingDriver]  = useState(false)

  const fileInputRef  = useRef<HTMLInputElement>(null)
  const autoGenFired  = useRef(false)

  const canEdit   = ['BT_USER', 'GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canAssign = ['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  const loadAgenda = useCallback(async () => {
    try {
      const [agendaRes, bookingRes] = await Promise.all([
        fetch(`/api/bookings/${ref}/agenda`),
        fetch(`/api/bookings/${ref}`),
      ])
      const [agendaJson, bookingJson] = await Promise.all([agendaRes.json(), bookingRes.json()])

      if (agendaJson.success && agendaJson.data) {
        setItems((agendaJson.data.items ?? []).map((raw: unknown) => {
          const i = raw as Partial<{
            id: string; date: string; location: string; fromPoint: string
            toPoint: string; details: string; mealPlan: string
            meetingTime: string; serviceType: string; assignment: AgendaItem['assignment']
          }>
          return {
            id: i.id, date: i.date?.slice(0, 10) ?? '', location: i.location ?? '',
            fromPoint: i.fromPoint ?? '', toPoint: i.toPoint ?? '',
            details: i.details ?? '', mealPlan: i.mealPlan ?? '',
            meetingTime: i.meetingTime ?? '', serviceType: i.serviceType ?? 'OWN_ARRANGEMENT',
            assignment: i.assignment,
          }
        }))
      }
      if (bookingJson.success && bookingJson.data) setBooking(bookingJson.data)
    } finally {
      setLoading(false)
    }
  }, [ref])

  async function loadDriversForDate(date: string) {
    setLoadingDrivers(true)
    try {
      const url  = date ? `/api/ground/drivers?date=${date}&excludeRef=${ref}` : '/api/ground/drivers'
      const res  = await fetch(url)
      const json = await res.json()
      if (json.success) setDrivers(json.data)
    } finally {
      setLoadingDrivers(false)
    }
  }

  useEffect(() => { loadAgenda() }, [loadAgenda])

  useEffect(() => {
    if (!loading && items.length === 0 && canEdit && !autoGenFired.current) {
      autoGenFired.current = true
      generateFromBooking()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  function normaliseItems(raw: AgendaItem[]): AgendaItem[] {
    return raw.map(item => ({
      ...item,
      date: (item.date as string)?.slice(0, 10) ?? '',
      fromPoint: item.fromPoint ?? '', toPoint: item.toPoint ?? '',
      details: item.details ?? '', mealPlan: item.mealPlan ?? '',
      meetingTime: item.meetingTime ?? '', serviceType: item.serviceType ?? 'OWN_ARRANGEMENT',
    }))
  }

  async function persistItems(itemsToSave: AgendaItem[], silent = false) {
    const res  = await fetch(`/api/bookings/${ref}/agenda`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: itemsToSave }),
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error)
    if (!silent) toast.success('Movement chart saved!')
    await loadAgenda()
  }

  async function generateFromFile(file: File) {
    setGenerating(true); setShowUpload(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res  = await fetch(`/api/bookings/${ref}/agenda/generate`, { method: 'POST', body: formData })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const normalised = normaliseItems(json.data.items as AgendaItem[])
      setItems(normalised)
      await persistItems(normalised, true)
      toast.success(`Generated & saved ${normalised.length} movement items`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally { setGenerating(false) }
  }

  async function generateFromBooking() {
    setGenerating(true)
    try {
      const res  = await fetch(`/api/bookings/${ref}/agenda/generate`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const normalised = normaliseItems(json.data.items as AgendaItem[])
      setItems(normalised)
      await persistItems(normalised, true)
      toast.success(`Generated & saved ${normalised.length} movement items`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally { setGenerating(false) }
  }

  async function saveAgenda() {
    setSaving(true)
    try {
      await persistItems(items)
      toast.success('Driver allocation saved')
      router.push(`/dashboard/bookings/${ref}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  async function saveAssignment(itemId: string, idx: number) {
    const item = items[idx]
    if (!item) return
    try {
      const res  = await fetch(`/api/bookings/${ref}/agenda`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, assignment: item.assignment }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Driver assigned!')
      setAssigningIdx(null)
      if (item.date) loadDriversForDate(item.date)
    } catch { toast.error('Failed to save assignment') }
  }

  async function setDriverForAllTours(driver: Driver) {
    const assignment = {
      driverId: driver.id, driverName: driver.name, driverPhone: driver.phone,
      vehicleType: driver.vehicle?.type ?? '', vehiclePlate: driver.vehicle?.plateNo ?? '',
    }
    setItems(is => is.map(x => ({ ...x, assignment })))
    toast.success(`${driver.name} set as driver for all ${items.length} items — save to confirm`)
    setAssigningIdx(null)
  }

  function openAssignPanel(idx: number) {
    setAssigningIdx(idx); setDriverSearch('')
    loadDriversForDate(items[idx]?.date ?? '')
  }

  async function aiDescribeItem(idx: number) {
    const item = items[idx]
    setDescribingIdx(idx)
    try {
      const res  = await fetch(`/api/bookings/${ref}/agenda/describe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: item.date, location: item.location,
          fromPoint: item.fromPoint, toPoint: item.toPoint,
          meetingTime: item.meetingTime, serviceType: item.serviceType,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setItems(is => is.map((x, j) => j === idx ? { ...x, details: json.data.description } : x))
      toast.success('AI description generated')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'AI describe failed')
    } finally { setDescribingIdx(null) }
  }

  async function openDriverView(driverId: string | null | undefined, fallback: AgendaItem['assignment']) {
    if (!driverId) {
      // No stored driverId — show what we have from assignment
      setFullDriver({
        id: '', name: fallback?.driverName ?? '—', phone: fallback?.driverPhone ?? '—',
        email: null, licenseNo: null, photoUrl: null,
        vehicle: fallback?.vehiclePlate ? {
          plateNo: fallback.vehiclePlate, type: fallback.vehicleType ?? '—',
          brand: null, model: null, capacity: 0, description: null,
          photoOutside: null, photoInside: null,
        } : null,
      })
      setDriverModal(true)
      return
    }
    setLoadingDriver(true)
    setDriverModal(true)
    try {
      const res  = await fetch(`/api/ground/drivers/${driverId}`)
      const json = await res.json()
      if (json.success) setFullDriver(json.data as FullDriver)
      else toast.error('Could not load driver details')
    } finally { setLoadingDriver(false) }
  }

  function toggleDetails(idx: number) {
    setExpandedDetails(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  const filteredDrivers = drivers.filter(d =>
    d.isActive && (
      d.name.toLowerCase().includes(driverSearch.toLowerCase()) ||
      d.phone.includes(driverSearch) ||
      d.vehicle?.plateNo?.toLowerCase().includes(driverSearch.toLowerCase())
    )
  )

  function toggleSection(key: string) {
    setExpandedSection(s => s === key ? null : key)
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      <p className="text-sm text-slate-400">Loading movement chart...</p>
    </div>
  )

  return (
    <div>
      <Header
        title={`Movement Chart — ${ref}`}
        subtitle={generating ? 'Generating…' : `${items.length} item${items.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex gap-2">
            {canEdit && (
              <>
                <div className="relative">
                  <Button variant="secondary" size="sm" loading={generating}
                    icon={<Wand2 className="w-4 h-4" />}
                    onClick={() => setShowUpload(v => !v)}>
                    AI Generate
                  </Button>
                  {showUpload && (
                    <div className="absolute right-0 top-10 z-20 w-80 bg-white border border-slate-200 rounded-xl shadow-lg p-4">
                      <p className="text-sm font-semibold text-slate-800 mb-1">Generate Movement Chart with AI</p>
                      <p className="text-xs text-slate-500 mb-3">Upload a tour confirmation (.docx) or regenerate from booking data</p>
                      <input ref={fileInputRef} type="file" accept=".docx,.txt" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) generateFromFile(f); e.target.value = '' }} />
                      <div className="space-y-2">
                        <button onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center gap-2 p-3 rounded-lg border-2 border-dashed border-brand-200 hover:border-brand-400 hover:bg-brand-50 transition-colors text-sm font-medium text-brand-600">
                          <Upload className="w-4 h-4" /> Upload TC Document (.docx)
                        </button>
                        <button onClick={() => { setShowUpload(false); generateFromBooking() }}
                          className="w-full flex items-center gap-2 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors text-sm text-slate-600">
                          <Wand2 className="w-4 h-4" /> Regenerate from Booking Data
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <Button size="sm" loading={saving} icon={<Save className="w-4 h-4" />} onClick={saveAgenda}>
                  Save driver allocation
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-4 max-w-5xl">

        {/* ── BOOKING INFO PANELS ── */}
        {booking && (
          <div className="space-y-2">
            {/* Passengers */}
            {booking.passengers.length > 0 && (
              <Card className="overflow-hidden">
                <button onClick={() => toggleSection('passengers')}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-brand-500" />
                    <span className="text-sm font-semibold text-slate-800">Passengers</span>
                    <span className="text-xs text-slate-400 font-normal">
                      {booking.paxAdults} adult{booking.paxAdults !== 1 ? 's' : ''}{booking.paxChildren > 0 ? ` · ${booking.paxChildren} child${booking.paxChildren !== 1 ? 'ren' : ''}` : ''}
                    </span>
                  </div>
                  {expandedSection === 'passengers' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedSection === 'passengers' && (
                  <div className="border-t border-slate-100 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-4 py-2 text-left font-semibold">Name</th>
                          <th className="px-4 py-2 text-left font-semibold">Type</th>
                          <th className="px-4 py-2 text-left font-semibold">Passport</th>
                          <th className="px-4 py-2 text-left font-semibold">Nationality</th>
                          <th className="px-4 py-2 text-left font-semibold">Contact</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {booking.passengers.map(p => (
                          <tr key={p.id} className={p.isLead ? 'bg-brand-50' : ''}>
                            <td className="px-4 py-2.5 font-medium text-slate-900">
                              {p.name}{p.isLead && <span className="ml-1.5 text-[10px] font-bold text-brand-600 bg-brand-100 px-1.5 py-0.5 rounded">LEAD</span>}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500">{p.type ?? 'ADULT'}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{p.passport ?? '—'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{p.nationality ?? '—'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{p.contact ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* Flights */}
            {booking.flights.length > 0 && (
              <Card className="overflow-hidden">
                <button onClick={() => toggleSection('flights')}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Plane className="w-4 h-4 text-sky-500" />
                    <span className="text-sm font-semibold text-slate-800">Flights</span>
                    <span className="text-xs text-slate-400 font-normal">{booking.flights.length} segment{booking.flights.length !== 1 ? 's' : ''}</span>
                  </div>
                  {expandedSection === 'flights' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedSection === 'flights' && (
                  <div className="border-t border-slate-100 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-4 py-2 text-left font-semibold">Flight</th>
                          <th className="px-4 py-2 text-left font-semibold">Date</th>
                          <th className="px-4 py-2 text-left font-semibold">From</th>
                          <th className="px-4 py-2 text-left font-semibold">Dep.</th>
                          <th className="px-4 py-2 text-left font-semibold">To</th>
                          <th className="px-4 py-2 text-left font-semibold">Arr.</th>
                          <th className="px-4 py-2 text-left font-semibold">Airline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {booking.flights.map(f => (
                          <tr key={f.id}>
                            <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{f.flightNo}</td>
                            <td className="px-4 py-2.5 text-slate-600">{formatDate(f.date)}</td>
                            <td className="px-4 py-2.5 font-semibold text-slate-900">{f.fromApt}</td>
                            <td className="px-4 py-2.5 text-slate-600">{f.depTime ?? '—'}</td>
                            <td className="px-4 py-2.5 font-semibold text-slate-900">{f.toApt}</td>
                            <td className="px-4 py-2.5 text-slate-600">{f.arrTime ?? '—'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{f.airline ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* Accommodations */}
            {booking.accommodations.length > 0 && (
              <Card className="overflow-hidden">
                <button onClick={() => toggleSection('accommodations')}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Hotel className="w-4 h-4 text-indigo-500" />
                    <span className="text-sm font-semibold text-slate-800">Accommodation</span>
                    <span className="text-xs text-slate-400 font-normal">{booking.accommodations.length} hotel{booking.accommodations.length !== 1 ? 's' : ''}</span>
                  </div>
                  {expandedSection === 'accommodations' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedSection === 'accommodations' && (
                  <div className="border-t border-slate-100 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-4 py-2 text-left font-semibold">Hotel</th>
                          <th className="px-4 py-2 text-left font-semibold">City</th>
                          <th className="px-4 py-2 text-left font-semibold">Check-in</th>
                          <th className="px-4 py-2 text-left font-semibold">Check-out</th>
                          <th className="px-4 py-2 text-left font-semibold">Nights</th>
                          <th className="px-4 py-2 text-left font-semibold">Room</th>
                          {/* Meal column only shown if any accommodation has mealType set */}
                          {booking.accommodations.some(a => a.mealType) && (
                            <th className="px-4 py-2 text-left font-semibold">Meal</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {booking.accommodations.map(a => (
                          <tr key={a.id}>
                            <td className="px-4 py-2.5 font-medium text-slate-900">{a.hotel}</td>
                            <td className="px-4 py-2.5 text-slate-600">{a.city}</td>
                            <td className="px-4 py-2.5 text-slate-600">{formatDate(a.checkIn)}</td>
                            <td className="px-4 py-2.5 text-slate-600">{formatDate(a.checkOut)}</td>
                            <td className="px-4 py-2.5 text-slate-500">{a.nights}</td>
                            <td className="px-4 py-2.5 text-slate-500">{a.roomType ?? '—'}</td>
                            {booking.accommodations.some(ac => ac.mealType) && (
                              <td className="px-4 py-2.5 text-slate-500">{a.mealType ?? '—'}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* Emergency Contacts */}
            {booking.emergencyContacts.length > 0 && (
              <Card className="overflow-hidden">
                <button onClick={() => toggleSection('emergency')}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-500" />
                    <span className="text-sm font-semibold text-slate-800">Emergency Contacts</span>
                    <span className="text-xs text-slate-400 font-normal">{booking.emergencyContacts.length} contact{booking.emergencyContacts.length !== 1 ? 's' : ''}</span>
                  </div>
                  {expandedSection === 'emergency' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedSection === 'emergency' && (
                  <div className="border-t border-slate-100">
                    <div className="px-4 py-3 flex flex-wrap gap-3">
                      {booking.emergencyContacts.map(ec => (
                        <div key={ec.id} className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                          <Phone className="w-3.5 h-3.5 text-red-400" />
                          <div>
                            <p className="text-sm font-semibold text-red-800">{ec.name}</p>
                            <p className="text-xs text-red-600">{ec.phone ?? '—'}{ec.role ? ` · ${ec.role}` : ''}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}

        {/* ── AI GENERATING OVERLAY ── */}
        {generating && (
          <Card className="p-8 text-center">
            <Loader2 className="w-8 h-8 text-brand-500 animate-spin mx-auto mb-3" />
            <p className="text-slate-700 font-semibold">AI is generating the movement chart…</p>
            <p className="text-slate-400 text-sm mt-1">Applying airport transfer rules, meeting times and meal plans</p>
          </Card>
        )}

        {/* ── EMPTY STATE ── */}
        {!generating && items.length === 0 && (
          <Card className="p-12 text-center">
            <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium mb-2">No movement items yet</p>
            {canEdit && <p className="text-slate-400 text-sm">Use &quot;AI Generate&quot; above to regenerate, or add items manually</p>}
          </Card>
        )}

        {/* ── MOVEMENT ITEMS ── */}
        {!generating && items.map((item, i) => {
          const svcType    = SERVICE_TYPES.find(s => s.value === item.serviceType)
          const isAssigning = assigningIdx === i
          const detailsOpen = expandedDetails.has(i)

          return (
            <Card key={i} className="overflow-hidden">
              <div className="flex">
                <div className={`w-1.5 flex-shrink-0 ${
                  item.serviceType === 'PVT_TRANSFER' ? 'bg-blue-400' :
                  item.serviceType === 'SIC_TRANSFER' ? 'bg-green-400' : 'bg-slate-200'
                }`} />

                <div className="flex-1 p-5">
                  {canEdit ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        <div>
                          <label className="form-label text-xs">Date</label>
                          <input type="date" className="form-input text-sm py-1.5" value={item.date}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} />
                        </div>
                        <div>
                          <label className="form-label text-xs">Location</label>
                          <input className="form-input text-sm py-1.5" value={item.location}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, location: e.target.value } : x))} />
                        </div>
                        <div>
                          <label className="form-label text-xs">From</label>
                          <input className="form-input text-sm py-1.5" value={item.fromPoint}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, fromPoint: e.target.value } : x))} />
                        </div>
                        <div>
                          <label className="form-label text-xs">To / Activity</label>
                          <input className="form-input text-sm py-1.5" value={item.toPoint}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, toPoint: e.target.value } : x))} />
                        </div>
                        <div>
                          <label className="form-label text-xs">Meeting Time</label>
                          <input type="time" className="form-input text-sm py-1.5" value={item.meetingTime}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, meetingTime: e.target.value } : x))} />
                        </div>
                        <div>
                          <label className="form-label text-xs">Service Type</label>
                          <select className="form-select text-sm py-1.5" value={item.serviceType}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, serviceType: e.target.value } : x))}>
                            {SERVICE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </div>

                        {/* Details / Timings — expandable with AI button */}
                        <div className="col-span-2 sm:col-span-3 lg:col-span-5">
                          <div className="flex items-center justify-between mb-1">
                            <label className="form-label text-xs mb-0">Details / Timings (Pickup &amp; Drop)</label>
                            <button
                              type="button"
                              onClick={() => aiDescribeItem(i)}
                              disabled={describingIdx === i}
                              className="flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-800 disabled:opacity-50"
                            >
                              {describingIdx === i
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Sparkles className="w-3 h-3" />}
                              AI Describe
                            </button>
                          </div>
                          <textarea
                            className="form-textarea text-sm py-1.5 resize-none"
                            rows={2}
                            value={item.details}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, details: e.target.value } : x))}
                            placeholder="Describe pickup time, drop-off location, transfer details…"
                          />
                        </div>

                        <div className="flex items-end gap-2">
                          <button onClick={() => setItems(is => is.filter((_, j) => j !== i))}
                            className="text-red-400 hover:text-red-600 mb-1">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {canAssign && (
                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                          {item.assignment?.driverName ? (
                            <button
                              onClick={() => openDriverView(item.assignment?.driverId, item.assignment)}
                              className="flex items-center gap-3 text-xs bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 hover:bg-blue-100 transition-colors"
                            >
                              <Car className="w-3.5 h-3.5 text-blue-500" />
                              <span className="font-medium text-blue-700">{item.assignment.driverName}</span>
                              {item.assignment.driverPhone && (
                                <span className="text-slate-500 flex items-center gap-1">
                                  <Phone className="w-3 h-3" />{item.assignment.driverPhone}
                                </span>
                              )}
                              {item.assignment.vehiclePlate && (
                                <span className="font-mono text-slate-600">{item.assignment.vehicleType} {item.assignment.vehiclePlate}</span>
                              )}
                              <Eye className="w-3 h-3 text-blue-400" />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 italic">No driver assigned</span>
                          )}
                          <Button variant="secondary" size="sm" icon={<Car className="w-3.5 h-3.5" />}
                            onClick={() => openAssignPanel(i)}>
                            {item.assignment?.driverName ? 'Re-assign' : 'Assign Driver'}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    // ── READ-ONLY VIEW ──
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-semibold text-slate-900">
                            {formatDate(item.date)} · {item.location}
                          </span>
                          {svcType && <Badge color={svcType.color}>{svcType.label}</Badge>}
                          {/* Only show meal plan badge if it has a value */}
                          {item.mealPlan && item.mealPlan.trim() !== '' && (
                            <Badge color="amber">{item.mealPlan}</Badge>
                          )}
                          {item.meetingTime && (
                            <span className="text-xs text-slate-500">Meet: {item.meetingTime}</span>
                          )}
                        </div>

                        {item.toPoint && (
                          <p className="text-sm text-slate-700 mt-1">
                            {item.fromPoint && <span className="text-slate-400">{item.fromPoint} → </span>}
                            {item.toPoint}
                          </p>
                        )}

                        {/* Expandable Details & Timings section */}
                        {item.details && item.details.trim() !== '' && (
                          <div className="mt-2">
                            <button
                              onClick={() => toggleDetails(i)}
                              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
                            >
                              <Info className="w-3.5 h-3.5" />
                              Details &amp; Timings
                              {detailsOpen
                                ? <ChevronUp className="w-3 h-3" />
                                : <ChevronDown className="w-3 h-3" />}
                            </button>
                            {detailsOpen && (
                              <p className="mt-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 leading-relaxed">
                                {item.details}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Allocated driver — clickable to view full info */}
                        {item.assignment?.driverName && (
                          <button
                            onClick={() => openDriverView(item.assignment?.driverId, item.assignment)}
                            className="mt-2 flex items-center gap-3 text-xs bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 w-fit hover:bg-blue-100 transition-colors"
                          >
                            <Car className="w-3.5 h-3.5 text-blue-500" />
                            <span className="font-medium text-blue-700">{item.assignment.driverName}</span>
                            {item.assignment.driverPhone && (
                              <span className="text-slate-500 flex items-center gap-1">
                                <Phone className="w-3 h-3" />{item.assignment.driverPhone}
                              </span>
                            )}
                            {item.assignment.vehiclePlate && (
                              <span className="font-mono text-slate-600">{item.assignment.vehicleType} {item.assignment.vehiclePlate}</span>
                            )}
                            <Eye className="w-3 h-3 text-blue-400" />
                          </button>
                        )}
                      </div>
                      {canAssign && (
                        <Button variant="secondary" size="sm" icon={<Car className="w-3.5 h-3.5" />}
                          onClick={() => openAssignPanel(i)}>
                          {item.assignment?.driverName ? 'Re-assign' : 'Assign Driver'}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Driver assignment panel */}
                  {isAssigning && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">Select Driver</p>
                          {item.date && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              Checking availability for <strong>{formatDate(item.date)}</strong>
                            </p>
                          )}
                        </div>
                        <button onClick={() => setAssigningIdx(null)} className="text-slate-400 hover:text-slate-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input value={driverSearch} onChange={e => setDriverSearch(e.target.value)}
                          placeholder="Search by name, phone, or plate…"
                          className="form-input pl-9 text-sm py-2" />
                      </div>

                      {loadingDrivers ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-72 overflow-y-auto">
                          {filteredDrivers.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-4">No active drivers found</p>
                          ) : (
                            filteredDrivers.map(d => {
                              const isSelected = items[i]?.assignment?.driverId === d.id
                              const isBusy     = d.isBusyOnDate ?? false
                              return (
                                <div key={d.id} className="space-y-1">
                                  <button
                                    onClick={() => setItems(is => is.map((x, j) => j === i ? {
                                      ...x,
                                      assignment: {
                                        driverId: d.id, driverName: d.name, driverPhone: d.phone,
                                        vehicleType: d.vehicle?.type ?? '', vehiclePlate: d.vehicle?.plateNo ?? '',
                                      },
                                    } : x))}
                                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                                      isSelected ? 'bg-brand-50 border-2 border-brand-300' :
                                      isBusy ? 'bg-red-50 border border-red-200 hover:bg-red-100' :
                                      'bg-slate-50 hover:bg-slate-100 border border-transparent'
                                    }`}
                                  >
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isBusy ? 'bg-red-100' : 'bg-blue-100'}`}>
                                      <span className={`font-bold text-sm ${isBusy ? 'text-red-700' : 'text-blue-700'}`}>{d.name.slice(0, 1)}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold text-sm text-slate-800">{d.name}</p>
                                        {isBusy && (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                            <AlertTriangle className="w-3 h-3" /> BUSY {d.busyBookings?.join(', ')}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-slate-500">
                                        {d.phone}{d.vehicle && ` · ${d.vehicle.brand ?? ''} ${d.vehicle.model ?? ''} ${d.vehicle.plateNo}`.trim()}
                                      </p>
                                    </div>
                                    {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                                  </button>
                                  {isSelected && items.length > 1 && (
                                    <button onClick={() => setDriverForAllTours(d)}
                                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold transition-colors">
                                      <UsersRound className="w-3.5 h-3.5" />
                                      Set {d.name} for All {items.length} Tour Items
                                    </button>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}

                      {item.assignment?.driverName && (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" onClick={() => item.id && saveAssignment(item.id, i)}>
                            Save Assignment
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => {
                            setItems(is => is.map((x, j) => j === i ? { ...x, assignment: null } : x))
                          }}>
                            Clear
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}

        {canEdit && !generating && (
          <Button variant="secondary" icon={<Plus className="w-4 h-4" />}
            onClick={() => setItems(is => [...is, {
              date: '', location: '', fromPoint: '', toPoint: '',
              details: '', mealPlan: '', meetingTime: '', serviceType: 'OWN_ARRANGEMENT',
            }])}>
            Add Movement Item
          </Button>
        )}
      </div>

      {/* ── DRIVER VIEW MODAL ── */}
      <Modal
        open={driverModal}
        onClose={() => { setDriverModal(false); setFullDriver(null) }}
        title="Driver & Vehicle Details"
      >
        {loadingDriver ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : fullDriver ? (
          <div className="space-y-5">
            {/* Driver info */}
            <div className="flex items-start gap-4">
              {fullDriver.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fullDriver.photoUrl} alt={fullDriver.name} className="w-16 h-16 rounded-full object-cover border-2 border-slate-200" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-2xl font-bold flex-shrink-0">
                  {fullDriver.name.charAt(0)}
                </div>
              )}
              <div>
                <h3 className="text-lg font-bold text-slate-900">{fullDriver.name}</h3>
                <div className="flex flex-col gap-1 mt-1">
                  <div className="flex items-center gap-1.5 text-sm text-slate-600">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {fullDriver.phone || <span className="text-slate-300">N/A</span>}
                  </div>
                  {fullDriver.email && (
                    <div className="flex items-center gap-1.5 text-sm text-slate-600">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      {fullDriver.email}
                    </div>
                  )}
                  {fullDriver.licenseNo && (
                    <div className="flex items-center gap-1.5 text-sm text-slate-600">
                      <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                      License: <span className="font-mono">{fullDriver.licenseNo}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Vehicle info */}
            <div className="border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Car className="w-4 h-4 text-blue-500" /> Vehicle
              </h4>
              {fullDriver.vehicle ? (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { label: 'Plate Number', value: fullDriver.vehicle.plateNo },
                      { label: 'Type',         value: fullDriver.vehicle.type },
                      { label: 'Brand',        value: fullDriver.vehicle.brand },
                      { label: 'Model',        value: fullDriver.vehicle.model },
                      { label: 'Capacity',     value: fullDriver.vehicle.capacity ? `${fullDriver.vehicle.capacity} seats` : null },
                      { label: 'Description',  value: fullDriver.vehicle.description },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
                        <p className="text-sm font-medium text-slate-800 mt-0.5">{value || <span className="text-slate-300">N/A</span>}</p>
                      </div>
                    ))}
                  </div>

                  {/* Vehicle photos */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Outside Photo</p>
                      {fullDriver.vehicle.photoOutside ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fullDriver.vehicle.photoOutside} alt="Vehicle outside"
                          className="w-full h-32 object-cover rounded-lg border border-slate-200" />
                      ) : (
                        <div className="w-full h-32 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-sm font-medium">
                          N/A
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Inside Photo</p>
                      {fullDriver.vehicle.photoInside ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fullDriver.vehicle.photoInside} alt="Vehicle inside"
                          className="w-full h-32 object-cover rounded-lg border border-slate-200" />
                      ) : (
                        <div className="w-full h-32 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-sm font-medium">
                          N/A
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-400 italic">No vehicle assigned to this driver</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
