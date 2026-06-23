'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Trash2, Save, Loader2, Wand2, Car, MapPin, Upload,
  Search, X, CheckCircle2, Phone, AlertTriangle, Users, Plane,
  Hotel, ShieldAlert, ChevronDown, ChevronUp, UsersRound,
  Sparkles, Eye, Mail, CreditCard, Info, Building2,
  FileDown, MessageCircle, Send, ChevronRight,
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
    vendorId?: string | null
    vendorName?: string | null
    driverName?: string
    driverPhone?: string
    vehicleType?: string
    vehiclePlate?: string
    driverRate?: number | null
    rateCurrency?: string | null
  } | null
}

interface PnlRateSuggestion {
  activity: string
  mmtRate: number
  category: string
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

interface Vendor {
  id: string
  name: string
  phone: string | null
  country: string | null
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
  passengers: { id: string; name: string; type: string; age?: number | null; passport?: string | null; nationality?: string | null; contact?: string | null; isLead?: boolean }[]
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
  const [vendors,        setVendors]        = useState<Vendor[]>([])
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [generating,     setGenerating]     = useState(false)
  const [showUpload,     setShowUpload]     = useState(false)
  const [assigningIdx,   setAssigningIdx]   = useState<number | null>(null)
  const [assignMode,     setAssignMode]     = useState<'driver' | 'vendor'>('driver')
  const [driverSearch,   setDriverSearch]   = useState('')
  const [loadingDrivers, setLoadingDrivers] = useState(false)
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [vendorDriverForm, setVendorDriverForm] = useState({ driverName: '', driverPhone: '', vehicleType: '', vehiclePlate: '' })
  const [expandedSection, setExpandedSection] = useState<string | null>('passengers')
  // Per-item expandable details (read mode)
  const [expandedDetails, setExpandedDetails] = useState<Set<number>>(new Set())
  // Per-item AI describe loading
  const [describingIdx,  setDescribingIdx]  = useState<number | null>(null)
  // Driver view modal
  const [driverModal,    setDriverModal]    = useState(false)
  const [fullDriver,     setFullDriver]     = useState<FullDriver | null>(null)
  const [loadingDriver,  setLoadingDriver]  = useState(false)

  // PDF send modal
  const [sendModal,       setSendModal]      = useState(false)
  const [sendMode,        setSendMode]       = useState<'whatsapp' | 'email'>('whatsapp')
  const [sendDrivers,     setSendDrivers]    = useState(true)
  const [sendTo,          setSendTo]         = useState('')
  const [sendMessage,     setSendMessage]    = useState('')
  const [sendSubject,     setSendSubject]    = useState('')
  const [sending,         setSending]        = useState(false)
  const [downloading,     setDownloading]    = useState<'with' | 'without' | null>(null)
  const [showPdfMenu,     setShowPdfMenu]    = useState(false)
  // Rate input for driver assignment
  const [rateInput,         setRateInput]        = useState('')
  const [rateCurrencyInput, setRateCurrencyInput] = useState('USD')
  const [pnlRates,          setPnlRates]         = useState<PnlRateSuggestion[]>([])

  const fileInputRef  = useRef<HTMLInputElement>(null)
  const autoGenFired  = useRef(false)
  const pdfMenuRef    = useRef<HTMLDivElement>(null)

  // Close PDF dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(e.target as Node)) {
        setShowPdfMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const canEdit   = ['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canAssign = ['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  async function downloadAgendaPdf(withDrivers: boolean) {
    setDownloading(withDrivers ? 'with' : 'without')
    try {
      const res = await fetch(`/api/bookings/${ref}/agenda/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'download', showDrivers: withDrivers }),
      })
      if (!res.ok) { toast.error('PDF generation failed'); return }
      const blob     = await res.blob()
      const url      = URL.createObjectURL(blob)
      const a        = document.createElement('a')
      a.href         = url
      a.download     = `${ref}-Agenda-${withDrivers ? 'WithDrivers' : 'NoDrivers'}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch { toast.error('Download failed') }
    finally  { setDownloading(null); setShowPdfMenu(false) }
  }

  async function sendAgenda() {
    if (!sendTo.trim()) { toast.error('Enter a recipient'); return }
    setSending(true)
    try {
      const res  = await fetch(`/api/bookings/${ref}/agenda/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode:        sendMode,
          showDrivers: sendDrivers,
          to:          sendTo.trim(),
          message:     sendMessage || undefined,
          subject:     sendSubject || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(`Agenda sent via ${sendMode === 'whatsapp' ? 'WhatsApp' : 'Email'}!`)
      setSendModal(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally { setSending(false) }
  }

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

  async function loadVendors() {
    try {
      const res  = await fetch('/api/ground/vendors')
      const json = await res.json()
      if (json.success) setVendors(json.data)
    } catch { /* non-critical */ }
  }

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
      router.push(`/dashboard/bookings/${ref}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  async function saveAssignment(itemId: string, idx: number, overrideAssignment?: AgendaItem['assignment']) {
    const item = items[idx]
    if (!item) return
    const assignment = overrideAssignment !== undefined ? overrideAssignment : item.assignment
    try {
      const res  = await fetch(`/api/bookings/${ref}/agenda`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, assignment }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      // Update local state with what was saved
      if (overrideAssignment !== undefined) {
        setItems(is => is.map((x, j) => j === idx ? { ...x, assignment: overrideAssignment } : x))
      }
      toast.success('Assignment saved!')
      setAssigningIdx(null)
      if (item.date) loadDriversForDate(item.date)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save assignment')
    }
  }

  async function setDriverForAllTours(driver: Driver) {
    const assignment = {
      driverId: driver.id, vendorId: null, vendorName: null,
      driverName: driver.name, driverPhone: driver.phone,
      vehicleType: driver.vehicle?.type ?? '', vehiclePlate: driver.vehicle?.plateNo ?? '',
    }
    setItems(is => is.map(x => ({ ...x, assignment })))
    toast.success(`${driver.name} set as driver for all ${items.length} items — save to confirm`)
    setAssigningIdx(null)
  }

  function openAssignPanel(idx: number) {
    const existing = items[idx]?.assignment
    setAssigningIdx(idx)
    setDriverSearch('')
    setAssignMode(existing?.vendorId ? 'vendor' : 'driver')
    setSelectedVendorId(existing?.vendorId ?? '')
    setVendorDriverForm({
      driverName:  existing?.driverName  ?? '',
      driverPhone: existing?.driverPhone ?? '',
      vehicleType: existing?.vehicleType ?? '',
      vehiclePlate: existing?.vehiclePlate ?? '',
    })
    setRateInput(existing?.driverRate != null ? String(existing.driverRate) : '')
    setRateCurrencyInput(existing?.rateCurrency ?? 'USD')
    loadDriversForDate(items[idx]?.date ?? '')
    loadVendors()
    // Load PNL rates from booking data already fetched
    if (booking) {
      const pnl = (booking as any).pnl
      if (pnl?.lineItems?.length) {
        const suggestions: PnlRateSuggestion[] = pnl.lineItems
          .filter((li: any) => li.category === 'TRANSPORT' && Number(li.mmtRate) > 0)
          .map((li: any) => ({ activity: li.activity, mmtRate: Number(li.mmtRate), category: li.category }))
          .slice(0, 6)
        setPnlRates(suggestions)
      }
    }
  }

  function applyVendorAssignment(idx: number) {
    if (!selectedVendorId) { toast.error('Select a vendor first'); return }
    const vendor = vendors.find(v => v.id === selectedVendorId)
    setItems(is => is.map((x, j) => j === idx ? {
      ...x,
      assignment: {
        driverId:    null,
        vendorId:    selectedVendorId,
        vendorName:  vendor?.name ?? '',
        driverName:  vendorDriverForm.driverName  || undefined,
        driverPhone: vendorDriverForm.driverPhone || undefined,
        vehicleType: vendorDriverForm.vehicleType || undefined,
        vehiclePlate: vendorDriverForm.vehiclePlate || undefined,
        driverRate:   rateInput ? Number(rateInput) : null,
        rateCurrency: rateCurrencyInput || 'USD',
      },
    } : x))
  }

  async function aiDescribeItem(idx: number) {
    const item = items[idx]
    setDescribingIdx(idx)
    try {
      const res  = await fetch(`/api/bookings/${ref}/agenda/describe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date:            item.date,
          location:        item.location,
          fromPoint:       item.fromPoint,
          toPoint:         item.toPoint,
          meetingTime:     item.meetingTime,
          serviceType:     item.serviceType,
          mealPlan:        item.mealPlan,
          existingDetails: item.details,
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
          <div className="flex gap-2 flex-wrap">
            {/* PDF Download — all users */}
            <div className="relative" ref={pdfMenuRef}>
              <button
                onClick={() => setShowPdfMenu(v => !v)}
                className="btn btn-secondary btn-sm flex items-center gap-1.5"
              >
                <FileDown className="w-4 h-4" />
                Download PDF
                <ChevronRight className="w-3 h-3 rotate-90" />
              </button>
              {showPdfMenu && (
                <div className="absolute right-0 top-10 z-30 w-60 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider px-4 pt-3 pb-1">Choose PDF Type</p>
                  <button
                    onClick={() => downloadAgendaPdf(true)}
                    disabled={downloading === 'with'}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-700 transition-colors"
                  >
                    {downloading === 'with' ? <Loader2 className="w-4 h-4 animate-spin text-brand-500" /> : <Car className="w-4 h-4 text-sky-500" />}
                    <span className="flex-1 text-left">With Driver Allocation</span>
                  </button>
                  <button
                    onClick={() => downloadAgendaPdf(false)}
                    disabled={downloading === 'without'}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-700 transition-colors border-t border-slate-100"
                  >
                    {downloading === 'without' ? <Loader2 className="w-4 h-4 animate-spin text-brand-500" /> : <FileDown className="w-4 h-4 text-slate-400" />}
                    <span className="flex-1 text-left">Without Driver Info</span>
                  </button>
                  <div className="border-t border-slate-100">
                    <button
                      onClick={() => { setShowPdfMenu(false); window.open(`/print/agenda/${ref}?drivers=true`, '_blank') }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-600 transition-colors"
                    >
                      <Eye className="w-4 h-4 text-slate-400" /> Print Preview (with drivers)
                    </button>
                    <button
                      onClick={() => { setShowPdfMenu(false); window.open(`/print/agenda/${ref}?drivers=false`, '_blank') }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-600 transition-colors border-t border-slate-100"
                    >
                      <Eye className="w-4 h-4 text-slate-400" /> Print Preview (no drivers)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* WhatsApp — all users */}
            <button
              onClick={() => {
                setSendMode('whatsapp')
                setSendDrivers(true)
                setSendTo((booking?.passengers.find(p => p.isLead) as { contact?: string | null } | undefined)?.contact ?? '')
                setSendMessage(`📋 Movement Chart for your booking ${ref}. Please find the agenda PDF attached.`)
                setSendSubject('')
                setSendModal(true)
              }}
              className="btn btn-sm bg-green-600 text-white border border-green-700 hover:bg-green-700 flex items-center gap-1.5"
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </button>

            {/* Email — all users */}
            <button
              onClick={() => {
                setSendMode('email')
                setSendDrivers(false)
                setSendTo('')
                setSendMessage('')
                setSendSubject(`Movement Chart — ${ref}`)
                setSendModal(true)
              }}
              className="btn btn-sm bg-blue-600 text-white border border-blue-700 hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Send className="w-4 h-4" /> Email
            </button>

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
                  Save
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-4">

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
                          {booking.passengers.some(p => p.type === 'CHILD' && p.age != null) && (
                            <th className="px-4 py-2 text-left font-semibold">Age</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {booking.passengers.map(p => (
                          <tr key={p.id} className={p.isLead ? 'bg-brand-50' : ''}>
                            <td className="px-4 py-2.5 font-medium text-slate-900">
                              {p.name}{p.isLead && <span className="ml-1.5 text-[10px] font-bold text-brand-600 bg-brand-100 px-1.5 py-0.5 rounded">LEAD</span>}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500">{p.type ?? 'ADULT'}</td>
                            {booking.passengers.some(p => p.type === 'CHILD' && p.age != null) && (
                              <td className="px-4 py-2.5 text-slate-500">
                                {p.type === 'CHILD' && p.age != null
                                  ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">{p.age} yrs</span>
                                  : '—'}
                              </td>
                            )}
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
                        <div>
                          <label className="form-label text-xs">Meal Plan</label>
                          <input
                            className="form-input text-sm py-1.5"
                            value={item.mealPlan}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, mealPlan: e.target.value } : x))}
                            placeholder="B / L / D / BL / BD / LD"
                          />
                        </div>

                        {/* Details / Timings — expandable with AI button */}
                        <div className="col-span-2 sm:col-span-3 lg:col-span-4">
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
                            className="form-textarea text-sm py-1.5 resize h-auto"
                            rows={2}
                            value={item.details}
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, details: e.target.value } : x))}
                            placeholder="Describe pickup time, drop-off location, transfer details…"
                          />
                        </div>

                        <div className="flex items-start gap-2 justify-end col-span-full mt-1">
                          <button onClick={() => setItems(is => is.filter((_, j) => j !== i))}
                            className="text-red-400 hover:text-red-600 mb-1">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {canAssign && (
                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                          {item.assignment?.driverName ? (
                            item.assignment.vendorId ? (
                              <div className="flex items-center gap-2 text-xs bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                                <Building2 className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                                <span className="font-semibold text-violet-700">{item.assignment.vendorName}</span>
                                <span className="text-slate-400">·</span>
                                <span className="font-medium text-slate-700">{item.assignment.driverName}</span>
                                {item.assignment.driverPhone && (
                                  <span className="text-slate-500 flex items-center gap-1">
                                    <Phone className="w-3 h-3" />{item.assignment.driverPhone}
                                  </span>
                                )}
                                {item.assignment.vehiclePlate && (
                                  <span className="font-mono text-slate-600">{item.assignment.vehicleType} {item.assignment.vehiclePlate}</span>
                                )}
                                {item.assignment.driverRate != null && (
                                  <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                                    {item.assignment.rateCurrency ?? 'USD'} {Number(item.assignment.driverRate).toFixed(0)}
                                  </span>
                                )}
                              </div>
                            ) : (
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
                                {item.assignment.driverRate != null && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                                    {item.assignment.rateCurrency ?? 'USD'} {Number(item.assignment.driverRate).toFixed(0)}
                                  </span>
                                )}
                                <Eye className="w-3 h-3 text-blue-400" />
                              </button>
                            )
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
                          item.assignment.vendorId ? (
                            <div className="mt-2 flex items-center gap-2 text-xs bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 w-fit">
                              <Building2 className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                              <span className="font-semibold text-violet-700">{item.assignment.vendorName}</span>
                              <span className="text-slate-400">·</span>
                              <span className="font-medium text-slate-700">{item.assignment.driverName}</span>
                              {item.assignment.driverPhone && (
                                <span className="text-slate-500 flex items-center gap-1">
                                  <Phone className="w-3 h-3" />{item.assignment.driverPhone}
                                </span>
                              )}
                              {item.assignment.vehiclePlate && (
                                <span className="font-mono text-slate-600">{item.assignment.vehicleType} {item.assignment.vehiclePlate}</span>
                              )}
                              {item.assignment.driverRate != null && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                                  {item.assignment.rateCurrency ?? 'USD'} {Number(item.assignment.driverRate).toFixed(0)}
                                </span>
                              )}
                            </div>
                          ) : (
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
                              {item.assignment.driverRate != null && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                                  {item.assignment.rateCurrency ?? 'USD'} {Number(item.assignment.driverRate).toFixed(0)}
                                </span>
                              )}
                              <Eye className="w-3 h-3 text-blue-400" />
                            </button>
                          )
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

                  {/* Driver / Vendor assignment panel */}
                  {isAssigning && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">Assign Driver</p>
                          {item.date && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {item.date && `Availability check for `}<strong>{formatDate(item.date)}</strong>
                            </p>
                          )}
                        </div>
                        <button onClick={() => setAssigningIdx(null)} className="text-slate-400 hover:text-slate-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Mode tabs */}
                      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg mb-4">
                        <button
                          onClick={() => setAssignMode('driver')}
                          className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-1.5 rounded-md font-medium transition-colors ${
                            assignMode === 'driver' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Car className="w-3.5 h-3.5" /> Driver
                        </button>
                        <button
                          onClick={() => setAssignMode('vendor')}
                          className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-1.5 rounded-md font-medium transition-colors ${
                            assignMode === 'vendor' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Building2 className="w-3.5 h-3.5" /> Vendor
                        </button>
                      </div>

                      {/* ── Rate input ── */}
                      <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                        <p className="text-[11px] font-semibold text-emerald-700 mb-2">💰 Driver Rate (MMT Cost)</p>
                        {pnlRates.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {pnlRates.map((r, ri) => (
                              <button key={ri} onClick={() => setRateInput(String(r.mmtRate))}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-emerald-200 hover:bg-emerald-100 text-emerald-700 font-medium transition-colors">
                                {r.activity.length > 22 ? r.activity.slice(0, 22) + '…' : r.activity} · {r.mmtRate}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <select value={rateCurrencyInput} onChange={e => setRateCurrencyInput(e.target.value)}
                            className="form-select text-xs py-1 w-20">
                            {['USD','VND','SGD','MYR','LKR','AUD','GBP'].map(c => <option key={c}>{c}</option>)}
                          </select>
                          <input type="number" value={rateInput} onChange={e => setRateInput(e.target.value)}
                            placeholder="0.00" className="form-input text-sm flex-1 py-1" step="0.01" min="0" />
                        </div>
                      </div>

                      {assignMode === 'driver' ? (
                        <>
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
                                            driverId: d.id, vendorId: null, vendorName: null,
                                            driverName: d.name, driverPhone: d.phone,
                                            vehicleType: d.vehicle?.type ?? '', vehiclePlate: d.vehicle?.plateNo ?? '',
                                            driverRate: rateInput ? Number(rateInput) : null,
                                            rateCurrency: rateCurrencyInput || 'USD',
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
                        </>
                      ) : (
                        /* ── VENDOR MODE ── */
                        <div className="space-y-3">
                          <div>
                            <label className="form-label text-xs">Vendor</label>
                            <select
                              className="form-select text-sm"
                              value={selectedVendorId}
                              onChange={e => setSelectedVendorId(e.target.value)}
                            >
                              <option value="">— Select vendor —</option>
                              {vendors.map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="form-label text-xs">Driver Name *</label>
                              <input
                                className="form-input text-sm py-1.5"
                                placeholder="Driver full name"
                                value={vendorDriverForm.driverName}
                                onChange={e => setVendorDriverForm(f => ({ ...f, driverName: e.target.value }))}
                              />
                            </div>
                            <div>
                              <label className="form-label text-xs">Driver Phone</label>
                              <input
                                className="form-input text-sm py-1.5"
                                placeholder="+84 ..."
                                value={vendorDriverForm.driverPhone}
                                onChange={e => setVendorDriverForm(f => ({ ...f, driverPhone: e.target.value }))}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="form-label text-xs">Vehicle Type</label>
                              <input
                                className="form-input text-sm py-1.5"
                                placeholder="Van, Bus, Car…"
                                value={vendorDriverForm.vehicleType}
                                onChange={e => setVendorDriverForm(f => ({ ...f, vehicleType: e.target.value }))}
                              />
                            </div>
                            <div>
                              <label className="form-label text-xs">Plate No</label>
                              <input
                                className="form-input text-sm py-1.5 font-mono"
                                placeholder="51A-12345"
                                value={vendorDriverForm.vehiclePlate}
                                onChange={e => setVendorDriverForm(f => ({ ...f, vehiclePlate: e.target.value }))}
                              />
                            </div>
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => applyVendorAssignment(i)}>
                            Apply
                          </Button>
                        </div>
                      )}

                      {(item.assignment?.driverName || item.assignment?.vendorId || (assignMode === 'vendor' && selectedVendorId)) && (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" onClick={() => {
                            if (!item.id) return
                            if (assignMode === 'vendor' && selectedVendorId) {
                              const vendor = vendors.find(v => v.id === selectedVendorId)
                              const vendorAssignment: AgendaItem['assignment'] = {
                                driverId:    null,
                                vendorId:    selectedVendorId,
                                vendorName:  vendor?.name ?? '',
                                driverName:  vendorDriverForm.driverName  || undefined,
                                driverPhone: vendorDriverForm.driverPhone || undefined,
                                vehicleType: vendorDriverForm.vehicleType || undefined,
                                vehiclePlate: vendorDriverForm.vehiclePlate || undefined,
                                driverRate:   rateInput ? Number(rateInput) : null,
                                rateCurrency: rateCurrencyInput || 'USD',
                              }
                              saveAssignment(item.id, i, vendorAssignment)
                            } else {
                              saveAssignment(item.id, i)
                            }
                          }}>
                            Save Assignment
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => {
                            setItems(is => is.map((x, j) => j === i ? { ...x, assignment: null } : x))
                            setSelectedVendorId('')
                            setVendorDriverForm({ driverName: '', driverPhone: '', vehicleType: '', vehiclePlate: '' })
                            setRateInput('')
                            setRateCurrencyInput('USD')
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

      {/* ── SEND AGENDA MODAL ── */}
      <Modal
        open={sendModal}
        onClose={() => setSendModal(false)}
        title={`Send Movement Chart — ${ref}`}
      >
        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setSendMode('whatsapp')}
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-md font-medium transition-colors ${sendMode === 'whatsapp' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp
            </button>
            <button
              onClick={() => setSendMode('email')}
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-md font-medium transition-colors ${sendMode === 'email' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Mail className="w-4 h-4 text-blue-500" /> Email
            </button>
          </div>

          {/* Driver toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <p className="text-sm font-semibold text-slate-800">Include Driver Allocation</p>
              <p className="text-xs text-slate-400 mt-0.5">Show driver names, phones, and vehicle info in the PDF</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSendDrivers(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${sendDrivers ? 'bg-sky-500 text-white border-sky-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
              >
                <Car className="w-3 h-3 inline mr-1" />With Drivers
              </button>
              <button
                onClick={() => setSendDrivers(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${!sendDrivers ? 'bg-slate-700 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
              >
                Without Drivers
              </button>
            </div>
          </div>

          {/* To field */}
          <div>
            <label className="form-label text-xs">
              {sendMode === 'whatsapp' ? 'WhatsApp Number (no +)' : 'Email Address'}
            </label>
            <input
              className="form-input"
              type={sendMode === 'email' ? 'email' : 'tel'}
              placeholder={sendMode === 'whatsapp' ? '94771234567' : 'recipient@example.com'}
              value={sendTo}
              onChange={e => setSendTo(sendMode === 'whatsapp' ? e.target.value.replace(/\+/g, '') : e.target.value)}
            />
          </div>

          {/* Subject (email only) */}
          {sendMode === 'email' && (
            <div>
              <label className="form-label text-xs">Subject</label>
              <input
                className="form-input"
                placeholder={`Movement Chart — ${ref}`}
                value={sendSubject}
                onChange={e => setSendSubject(e.target.value)}
              />
            </div>
          )}

          {/* Message */}
          <div>
            <label className="form-label text-xs">Message (optional)</label>
            <textarea
              className="form-textarea resize-none text-sm"
              rows={3}
              value={sendMessage}
              onChange={e => setSendMessage(e.target.value)}
              placeholder="Add a custom message to include with the agenda PDF…"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button loading={sending} onClick={sendAgenda} className="flex-1">
              <Send className="w-4 h-4" />
              {sending ? 'Sending…' : `Send via ${sendMode === 'whatsapp' ? 'WhatsApp' : 'Email'}`}
            </Button>
            <Button variant="ghost" onClick={() => setSendModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

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
