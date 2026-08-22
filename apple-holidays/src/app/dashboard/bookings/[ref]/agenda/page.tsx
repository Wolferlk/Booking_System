'use client'

import { Fragment, useCallback, useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Trash2, Save, Loader2, Wand2, Car, MapPin, Upload,
  Search, X, CheckCircle2, Phone, AlertTriangle, Users, Plane,
  Hotel, ShieldAlert, ChevronDown, ChevronUp, UsersRound,
  Sparkles, Eye, Mail, Info, Building2, Pencil,
  FileDown, MessageCircle, Send, ChevronRight, GripVertical, FileText,
  ClipboardList, Bus, Ticket, Hash, UserCheck, Palmtree, Store, Utensils,
  FileType,
} from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Modal from '@/components/ui/modal'
import DriverVendorModal from '@/components/shared/driver-vendor-modal'
import PartnerAssignPicker, { EMPTY_SELECTION, type PartnerSelection } from '@/components/partners/partner-assign-picker'
import { isPartnerEnabledForCountry, PARTNER_CONFIG, type PartnerKind } from '@/lib/partner-directory'
import { formatDate } from '@/lib/utils'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { SERVICE_TYPE_LABELS, isSicType } from '@/lib/service-types'
import { resolveIsHotelOnly } from '@/lib/driver-requirement'
import type { UserRole } from '@prisma/client'
import LogoSpinner from '@/components/shared/logo-spinner'
import JourneyMap from '@/components/bookings/journey-map'
import { ComboInput } from '@/components/ui/combo-input'
import { MEAL_PLAN_OPTIONS, seedSuggestions, mergeSuggestions } from '@/lib/agenda-suggestions'

const MEAL_ABBREV: Record<string, string> = {
  'B':   'Breakfast',
  'L':   'Lunch',
  'D':   'Dinner',
  'BL':  'Breakfast, Lunch',  'LB':  'Breakfast, Lunch',
  'BD':  'Breakfast, Dinner', 'DB':  'Breakfast, Dinner',
  'LD':  'Lunch, Dinner',     'DL':  'Lunch, Dinner',
  'BLD': 'Breakfast, Lunch, Dinner', 'BDL': 'Breakfast, Lunch, Dinner',
  'LBD': 'Breakfast, Lunch, Dinner',
}
function normalizeMealPlan(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return ''
  const upper = raw.trim().toUpperCase().replace(/[\s,/]+/g, '')
  return MEAL_ABBREV[upper] ?? raw.trim()
}

/** Strip everything except digits so numbers are WhatsApp-ready: "+91 7715805191" → "917715805191". */
function normalizeWhatsApp(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '')
}

const SERVICE_TYPES = [
  { value: 'SIC_TOUR',              label: SERVICE_TYPE_LABELS.SIC_TOUR,              color: 'green'  as const, icon: Bus },
  { value: 'PVT_TOUR',              label: SERVICE_TYPE_LABELS.PVT_TOUR,              color: 'blue'   as const, icon: Car },
  { value: 'PVT_TRANSFER',          label: SERVICE_TYPE_LABELS.PVT_TRANSFER,          color: 'blue'   as const, icon: Car },
  { value: 'PVT_TRANSFER_TICKET',   label: SERVICE_TYPE_LABELS.PVT_TRANSFER_TICKET,   color: 'purple' as const, icon: Ticket },
  { value: 'PVT_TRANSFER_SPA',      label: SERVICE_TYPE_LABELS.PVT_TRANSFER_SPA,      color: 'teal'   as const, icon: Sparkles },
  { value: 'INTERNAL_TOUR',         label: SERVICE_TYPE_LABELS.INTERNAL_TOUR,         color: 'purple' as const, icon: Ticket },
  { value: 'ACCOMMODATION',         label: SERVICE_TYPE_LABELS.ACCOMMODATION,         color: 'amber'  as const, icon: Hotel },
  { value: 'MEAL_COUPON',           label: SERVICE_TYPE_LABELS.MEAL_COUPON,           color: 'orange' as const, icon: Utensils },
  { value: 'PVT_TRANSFER_SIC_TOUR', label: SERVICE_TYPE_LABELS.PVT_TRANSFER_SIC_TOUR, color: 'teal'   as const, icon: Bus },
  { value: 'OWN_ARRANGEMENT',       label: SERVICE_TYPE_LABELS.OWN_ARRANGEMENT,       color: 'gray'   as const, icon: Users },
  { value: 'SIC_TRANSFER',          label: SERVICE_TYPE_LABELS.SIC_TRANSFER,          color: 'green'  as const, icon: Bus },
  { value: 'PVT_TRANSFER_MEAL',     label: SERVICE_TYPE_LABELS.PVT_TRANSFER_MEAL,     color: 'orange' as const, icon: Utensils },
]

const SERVICE_STRIP: Record<string, { bg: string; iconBg: string; iconColor: string; icon: typeof Car }> = {
  PVT_TRANSFER:          { bg: 'bg-blue-400',   iconBg: 'bg-blue-100',   iconColor: 'text-blue-600',   icon: Car },
  PVT_TOUR:              { bg: 'bg-blue-400',   iconBg: 'bg-blue-100',   iconColor: 'text-blue-600',   icon: Car },
  PVT_TRANSFER_TICKET:   { bg: 'bg-purple-400', iconBg: 'bg-purple-100', iconColor: 'text-purple-600', icon: Ticket },
  PVT_TRANSFER_SPA:      { bg: 'bg-teal-400',   iconBg: 'bg-teal-100',   iconColor: 'text-teal-600',   icon: Sparkles },
  PVT_TRANSFER_SIC_TOUR: { bg: 'bg-teal-400',   iconBg: 'bg-teal-100',   iconColor: 'text-teal-600',   icon: Bus },
  PVT_TRANSFER_MEAL:     { bg: 'bg-orange-400', iconBg: 'bg-orange-100', iconColor: 'text-orange-600', icon: Utensils },
  SIC_TRANSFER:          { bg: 'bg-green-400',  iconBg: 'bg-green-100',  iconColor: 'text-green-600',  icon: Bus },
  SIC_TOUR:              { bg: 'bg-green-400',  iconBg: 'bg-green-100',  iconColor: 'text-green-600',  icon: Bus },
  MEAL_COUPON:           { bg: 'bg-orange-400', iconBg: 'bg-orange-100', iconColor: 'text-orange-600', icon: Utensils },
  FLIGHT:                { bg: 'bg-indigo-400', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600', icon: Plane },
  INTERNAL_TOUR:         { bg: 'bg-purple-400', iconBg: 'bg-purple-100', iconColor: 'text-purple-600', icon: Ticket },
  ACCOMMODATION:         { bg: 'bg-amber-400',  iconBg: 'bg-amber-100',  iconColor: 'text-amber-600',  icon: Hotel },
  OWN_ARRANGEMENT:       { bg: 'bg-slate-300',  iconBg: 'bg-slate-100',  iconColor: 'text-slate-500',  icon: Users },
}

/** A movement needs a driver unless it is a leisure day or hotel only. */
function needsDriver(item: { isLeisure: boolean; isHotelOnly: boolean }) {
  return !item.isLeisure && !item.isHotelOnly
}

/**
 * The pair of "this movement needs no driver" toggles — Leisure Day and Hotel
 * Only. Either one marks the movement as requiring no allocation, which is what
 * completes the file on the Sri Lanka Driver Allocation board; they are mutually
 * exclusive, so the one that is off is hidden while the other is on.
 */
function NoDriverButtons({
  item, onToggle,
}: {
  item: { isLeisure: boolean; isHotelOnly: boolean }
  onToggle: (kind: 'leisure' | 'hotel') => void
}) {
  return (
    <>
      {!item.isHotelOnly && (
        <button
          type="button"
          onClick={() => onToggle('leisure')}
          title={item.isLeisure
            ? 'This day is marked as a leisure day. Click to make it a normal movement that needs a driver.'
            : 'Mark this as a free / at-leisure day — no driver will be allocated.'}
          className={`btn btn-sm flex items-center gap-1.5 ${
            item.isLeisure
              ? 'bg-amber-500 text-white border border-amber-600 hover:bg-amber-600'
              : 'btn-secondary'
          }`}
        >
          <Palmtree className="w-3.5 h-3.5" />
          {item.isLeisure ? 'Leisure Day' : "It's Leisure Day"}
        </button>
      )}
      {!item.isLeisure && (
        <button
          type="button"
          onClick={() => onToggle('hotel')}
          title={item.isHotelOnly
            ? 'This movement is hotel only. Click to make it a normal movement that needs a driver.'
            : 'Mark this as hotel only — accommodation or the guest’s own transport, so no driver will be allocated.'}
          className={`btn btn-sm flex items-center gap-1.5 ${
            item.isHotelOnly
              ? 'bg-pink-500 text-white border border-pink-600 hover:bg-pink-600'
              : 'btn-secondary'
          }`}
        >
          <Hotel className="w-3.5 h-3.5" />
          Hotel Only
        </button>
      )}
    </>
  )
}

interface AgendaItem {
  id?: string
  date: string
  location: string
  fromPoint: string
  toPoint: string
  details: string
  mealPlan: string
  meetingTime: string
  timeFrom: string
  timeTo: string
  serviceType: string
  /** Free day — no driver is allocated and the allocation controls are hidden. */
  isLeisure: boolean
  /**
   * Hotel only — accommodation, or the guest's own transport. Like a leisure day
   * it needs no driver, so the Sri Lanka Driver Allocation board counts the file
   * as allocated rather than pending. Mutually exclusive with `isLeisure`.
   */
  isHotelOnly: boolean
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
    /** Tour guide — `guideId` set when picked from the directory, null when typed in. */
    guideId?: string | null
    guideName?: string | null
    guidePhone?: string | null
    /** Local tour vendor / supplier for this movement. */
    tourVendorId?: string | null
    tourVendorName?: string | null
    tourVendorPhone?: string | null
  } | null
}

/**
 * Guide / tour-vendor chips for a movement. Rendered next to the driver
 * allocation in both the edit and read views, so who is running the movement
 * reads as one line rather than being buried in the assign dialog.
 */
function PartnerChips({ assignment }: { assignment: AgendaItem['assignment'] }) {
  if (!assignment?.guideName && !assignment?.tourVendorName) return null

  const chips = [
    assignment.guideName && {
      key: 'guide',
      icon: <Sparkles className="w-3 h-3 text-indigo-500" />,
      label: PARTNER_CONFIG.guide.label,
      name: assignment.guideName,
      phone: assignment.guidePhone,
      className: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    },
    assignment.tourVendorName && {
      key: 'tourVendor',
      icon: <Store className="w-3 h-3 text-teal-500" />,
      label: PARTNER_CONFIG.tourVendor.label,
      name: assignment.tourVendorName,
      phone: assignment.tourVendorPhone,
      className: 'bg-teal-50 border-teal-100 text-teal-700',
    },
  ].filter(Boolean) as {
    key: string; icon: React.ReactNode; label: string
    name: string; phone?: string | null; className: string
  }[]

  return (
    <>
      {chips.map(chip => (
        <div key={chip.key} className={`flex items-center gap-2 text-xs border rounded-lg px-3 py-2 w-fit ${chip.className}`}>
          {chip.icon}
          <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">{chip.label}</span>
          <span className="font-medium text-slate-700">{chip.name}</span>
          {chip.phone && (
            <span className="text-slate-500 flex items-center gap-1">
              <Phone className="w-3 h-3" />{chip.phone}
            </span>
          )}
        </div>
      ))}
    </>
  )
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
  email?: string | null
  licenseNo?: string | null
  photoUrl?: string | null
  isActive: boolean
  isBusyOnDate?: boolean
  busyBookings?: string[]
  vehicle: {
    plateNo: string
    type: string
    brand?: string | null
    model?: string | null
    capacity?: number | null
    description?: string | null
    photoInside?: string | null
    photoOutside?: string | null
    vendor?: { name: string } | null
  } | null
}

interface Vendor {
  id: string
  name: string
  phone: string | null
  country: string | null
}

interface BookingDetails {
  bookingRef: string
  agent: string
  agentBookingId?: string | null
  isNumber?: string | null
  cntlNumber?: string | null
  tourDestination?: string | null
  operationCountry?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  contactWhatsapp?: string | null
  paxAdults: number
  paxChildren: number
  paxInfants: number
  arrivalDate: string
  departureDate: string
  passengers: { id: string; name: string; type: string; age?: number | null; passport?: string | null; nationality?: string | null; contact?: string | null; isLead?: boolean; mealPreference?: string | null }[]
  flights: { id: string; flightNo: string; date: string; fromApt: string; depTime?: string | null; toApt: string; arrTime?: string | null; airline?: string | null }[]
  accommodations: { id: string; hotel: string; city: string; checkIn: string; checkOut: string; nights: number; roomType?: string | null; mealType?: string | null }[]
  emergencyContacts: { id: string; name: string; phone?: string | null; role?: string | null }[]
  itineraryItems: { id: string; dayNo: number; date: string; title: string; description?: string | null }[]
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
  const [photoLightbox,  setPhotoLightbox]  = useState<{ url: string; label: string } | null>(null)
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [vendorDriverForm, setVendorDriverForm] = useState({ driverName: '', driverPhone: '', vehicleType: '', vehiclePlate: '' })
  const [vendorDrivers, setVendorDrivers]         = useState<Driver[]>([])
  const [loadingVendorDrivers, setLoadingVendorDrivers] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>('passengers')
  // Per-item expandable details (read mode)
  const [expandedDetails, setExpandedDetails] = useState<Set<number>>(new Set())
  // Per-item AI describe loading
  const [describingIdx,  setDescribingIdx]  = useState<number | null>(null)
  // Drag-to-reorder state
  const [dragIndex,      setDragIndex]      = useState<number | null>(null)
  const [dragOverIndex,  setDragOverIndex]  = useState<number | null>(null)
  // Driver / vendor view modal
  const [driverModalTarget, setDriverModalTarget] = useState<AgendaItem['assignment'] | null>(null)

  // Agenda send modal
  const [sendModal,       setSendModal]      = useState(false)
  const [sendMode,        setSendMode]       = useState<'whatsapp' | 'email'>('whatsapp')
  // Attachment format — PDF is the default; Word ships the same .docx as "Download Word".
  const [sendFormat,      setSendFormat]     = useState<'pdf' | 'word'>('pdf')
  const [sendDrivers,     setSendDrivers]    = useState(true)
  const [sendTo,          setSendTo]         = useState('')
  const [sendMessage,     setSendMessage]    = useState('')
  const [sendSubject,     setSendSubject]    = useState('')
  const [sending,         setSending]        = useState(false)
  const [showPdfMenu,     setShowPdfMenu]    = useState(false)
  const [downloadingWord, setDownloadingWord] = useState(false)
  const [editPassengersModal, setEditPassengersModal] = useState(false)
  const [editingPaxAdults, setEditingPaxAdults] = useState('')
  const [editingPaxChildren, setEditingPaxChildren] = useState('')
  const [editingPaxInfants, setEditingPaxInfants] = useState('')
  const [savingPassengers, setSavingPassengers] = useState(false)
  // Rate input for driver assignment
  const [rateInput,         setRateInput]        = useState('')
  const [rateCurrencyInput, setRateCurrencyInput] = useState('USD')
  const [pnlRates,          setPnlRates]         = useState<PnlRateSuggestion[]>([])
  const [vendorSearch,      setVendorSearch]      = useState('')
  // Which partner kinds this booking's country operates with (Settings-driven).
  const [partnerCountries,  setPartnerCountries]  = useState<Record<PartnerKind, string[]>>({ guide: [], tourVendor: [] })
  const [guideSel,          setGuideSel]          = useState<PartnerSelection>(EMPTY_SELECTION)
  const [tourVendorSel,     setTourVendorSel]     = useState<PartnerSelection>(EMPTY_SELECTION)

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

  const canEdit   = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canAssign = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  // Guides / tour vendors are only used in some countries, so the controls
  // appear on a movement only when this booking's country is switched on.
  useEffect(() => {
    fetch('/api/public/partner-settings')
      .then(r => r.json())
      .then(json => { if (json.success) setPartnerCountries(json.data) })
      .catch(() => { /* leave both off — the chart works exactly as before */ })
  }, [])

  const partnerCountry     = booking?.operationCountry ?? null
  const guidesEnabled      = isPartnerEnabledForCountry(partnerCountries.guide, partnerCountry)
  const tourVendorsEnabled = isPartnerEnabledForCountry(partnerCountries.tourVendor, partnerCountry)

  /**
   * Route / activity suggestions for this booking's country. Curated seed list
   * first, then whatever the desk has actually used on past agendas (fetched
   * below). Every field stays free text — a tour that is not on the list is
   * simply typed in and saved as typed.
   */
  const [routeOptions, setRouteOptions] = useState<{ location: string[]; fromPoint: string[]; toPoint: string[] }>({
    location: [], fromPoint: [], toPoint: [],
  })

  useEffect(() => {
    const country = booking?.operationCountry
    if (!country) return
    // Seed immediately so the dropdowns work before the history call lands.
    setRouteOptions({
      location:  seedSuggestions('location',  country),
      fromPoint: seedSuggestions('fromPoint', country),
      toPoint:   seedSuggestions('toPoint',   country),
    })
    let live = true
    fetch(`/api/agenda/suggestions?country=${encodeURIComponent(country)}`)
      .then(r => r.json())
      .then(json => {
        if (!live || !json.success) return
        setRouteOptions(o => ({
          location:  mergeSuggestions(json.data.location,  o.location),
          fromPoint: mergeSuggestions(json.data.fromPoint, o.fromPoint),
          toPoint:   mergeSuggestions(json.data.toPoint,   o.toPoint),
        }))
      })
      .catch(() => { /* keep the seed list — suggestions are a convenience */ })
    return () => { live = false }
  }, [booking?.operationCountry])

  async function sendAgenda() {
    // WhatsApp numbers must be digits-only (no "+" / spaces); e-mail keeps its raw value.
    const recipient = sendMode === 'whatsapp' ? normalizeWhatsApp(sendTo) : sendTo.trim()
    if (!recipient) { toast.error(sendMode === 'whatsapp' ? 'Enter a WhatsApp number' : 'Enter an email address'); return }
    if (sendMode === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) { toast.error('Enter a valid email address'); return }

    const subject = sendMode === 'email'
      ? (sendSubject.trim() || `Tour Confirmation — ${ref}`)   // auto subject fallback
      : undefined

    setSending(true)
    try {
      const res  = await fetch(`/api/bookings/${ref}/agenda/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode:        sendMode,
          format:      sendFormat,
          showDrivers: sendDrivers,
          to:          recipient,
          message:     sendMessage || undefined,
          subject,
        }),
      })

      // The server may return an empty/non-JSON body on a hard failure (timeout, crash) —
      // read the text first and only then attempt to parse, so we surface a real message.
      const raw = await res.text()
      let json: { success?: boolean; error?: string } = {}
      if (raw) { try { json = JSON.parse(raw) } catch { /* non-JSON body */ } }

      if (!res.ok || !json.success) {
        throw new Error(json.error || `Send failed (${res.status} ${res.statusText})`)
      }
      toast.success(`Agenda ${sendFormat === 'word' ? 'Word file' : 'PDF'} sent via ${sendMode === 'whatsapp' ? 'WhatsApp' : 'Email'}!`)
      setSendModal(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally { setSending(false) }
  }

  async function downloadWord() {
    setDownloadingWord(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/agenda/word`)
      if (!res.ok) throw new Error('Failed to generate Word file')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${ref}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally { setDownloadingWord(false) }
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
            meetingTime: string; timeFrom: string; timeTo: string
            serviceType: string; isLeisure: boolean | null; isHotelOnly: boolean | null
            assignment: AgendaItem['assignment']
          }>
          const serviceType = i.serviceType ?? 'PVT_TRANSFER'
          return {
            id: i.id, date: i.date?.slice(0, 10) ?? '', location: i.location ?? '',
            fromPoint: i.fromPoint ?? '', toPoint: i.toPoint ?? '',
            details: i.details ?? '', mealPlan: normalizeMealPlan(i.mealPlan),
            meetingTime: i.meetingTime ?? '', timeFrom: i.timeFrom ?? '',
            timeTo: i.timeTo ?? '', serviceType,
            // Agendas saved before the isLeisure column existed come back null —
            // fall back to text detection so they still read as leisure days.
            isLeisure: resolveIsLeisure({
              isLeisure: i.isLeisure, serviceType,
              location: i.location, toPoint: i.toPoint, details: i.details,
            }),
            isHotelOnly: resolveIsHotelOnly({ isHotelOnly: i.isHotelOnly }),
            assignment: i.assignment,
          }
        }))
      }
      if (bookingJson.success && bookingJson.data) setBooking(bookingJson.data)
    } finally {
      setLoading(false)
    }
  }, [ref])

  // Restrict driver/vendor lists to the booking's operation country.
  // Drivers/vendors without a specific country are shown for every country's bookings.
  function bookingCountry() {
    return booking?.operationCountry || ''
  }

  async function loadVendors() {
    try {
      const c    = bookingCountry()
      const res  = await fetch(`/api/ground/vendors${c ? `?country=${encodeURIComponent(c)}` : ''}`)
      const json = await res.json()
      if (json.success) setVendors(json.data)
    } catch { /* non-critical */ }
  }

  async function loadVendorDrivers(vendorId: string) {
    if (!vendorId) { setVendorDrivers([]); return }
    setLoadingVendorDrivers(true)
    try {
      const res  = await fetch(`/api/ground/drivers?vendorId=${vendorId}`)
      const json = await res.json()
      if (json.success) setVendorDrivers(json.data)
    } catch { /* non-critical */ }
    finally { setLoadingVendorDrivers(false) }
  }

  async function loadDriversForDate(date: string) {
    setLoadingDrivers(true)
    try {
      const params = new URLSearchParams()
      if (date) { params.set('date', date); params.set('excludeRef', ref) }
      const c = bookingCountry()
      if (c) params.set('country', c)
      const qs   = params.toString()
      const url  = qs ? `/api/ground/drivers?${qs}` : '/api/ground/drivers'
      const res  = await fetch(url)
      const json = await res.json()
      if (json.success) setDrivers(json.data)
    } finally {
      setLoadingDrivers(false)
    }
  }

  useEffect(() => { loadAgenda() }, [loadAgenda])

  // OPS_AI "open agenda, generating if needed": when opened with ?generate=1 and
  // the booking has no movement items yet, auto-run the standard generate+save
  // once, then strip the flag so a refresh doesn't re-trigger it.
  const [wantsGenerate, setWantsGenerate] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWantsGenerate(new URLSearchParams(window.location.search).get('generate') === '1')
    }
  }, [])
  const autoGenRef     = useRef(false)
  useEffect(() => {
    if (!wantsGenerate || autoGenRef.current) return
    if (loading || generating || !booking) return
    if (items.length > 0) {
      // Already has an agenda — nothing to generate; just clean the URL.
      autoGenRef.current = true
      router.replace(`/dashboard/bookings/${ref}/agenda`)
      return
    }
    if (!canEdit) return
    autoGenRef.current = true
    void generateFromBooking().finally(() => {
      router.replace(`/dashboard/bookings/${ref}/agenda`)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsGenerate, loading, generating, booking, items.length, canEdit, ref])

  useEffect(() => {
    if (!loading && items.length === 0 && canEdit && !autoGenFired.current) {
      autoGenFired.current = true
      generateFromBooking()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  function normaliseItems(raw: AgendaItem[]): AgendaItem[] {
    return raw.map(item => {
      const serviceType = item.serviceType ?? 'PVT_TRANSFER'
      return {
        ...item,
        date: (item.date as string)?.slice(0, 10) ?? '',
        fromPoint: item.fromPoint ?? '', toPoint: item.toPoint ?? '',
        details: item.details ?? '', mealPlan: normalizeMealPlan(item.mealPlan),
        meetingTime: item.meetingTime ?? '', timeFrom: (item as any).timeFrom ?? '',
        timeTo: (item as any).timeTo ?? '', serviceType,
        isLeisure: resolveIsLeisure({ ...item, serviceType }),
        isHotelOnly: resolveIsHotelOnly(item),
      }
    })
  }

  async function persistItems(itemsToSave: AgendaItem[], silent = false) {
    // Caught here as well as on the server: a date the database will reject
    // should never leave the browser, since saving rewrites the whole chart.
    const badDate = itemsToSave.findIndex(it => {
      if (!it.date) return true
      const y = Number(String(it.date).slice(0, 4))
      return !Number.isFinite(y) || y < 1900 || y > 2200 || Number.isNaN(new Date(it.date).getTime())
    })
    if (badDate !== -1) {
      throw new Error(`Movement ${badDate + 1} has a missing or invalid date (${itemsToSave[badDate].date || 'blank'}) — fix it and save again`)
    }

    const res  = await fetch(`/api/bookings/${ref}/agenda`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: itemsToSave }),
    })
    // A server crash returns an empty or HTML body; parsing it blindly surfaces
    // the useless "Unexpected end of JSON input" instead of the real failure.
    const raw  = await res.text()
    let json: { success?: boolean; error?: string }
    try {
      json = raw ? JSON.parse(raw) : {}
    } catch {
      throw new Error(`Save failed (${res.status}). The server returned an unexpected response.`)
    }
    if (!res.ok || !json.success) throw new Error(json.error || `Save failed (${res.status})`)
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

  function openPassengerCountEditor() {
    if (!booking) return
    setEditingPaxAdults(String(booking.paxAdults ?? 0))
    setEditingPaxChildren(String(booking.paxChildren ?? 0))
    setEditingPaxInfants(String(booking.paxInfants ?? 0))
    setEditPassengersModal(true)
  }

  async function savePassengerCounts() {
    if (!booking) return
    const adults = Number(editingPaxAdults)
    const children = Number(editingPaxChildren)

    if (!Number.isInteger(adults) || adults < 0) {
      toast.error('Adults must be a whole number')
      return
    }
    if (!Number.isInteger(children) || children < 0) {
      toast.error('Children must be a whole number')
      return
    }
    const infants = Number(editingPaxInfants)
    if (!Number.isInteger(infants) || infants < 0) {
      toast.error('Infants must be a whole number')
      return
    }

    setSavingPassengers(true)
    try {
      const res = await fetch(`/api/bookings/${ref}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paxAdults: adults,
          paxChildren: children,
          paxInfants: infants,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Passenger counts updated')
      setEditPassengersModal(false)
      await loadAgenda()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingPassengers(false)
    }
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
      // The server reports whether the driver's WhatsApp actually went out.
      toast.success(json.message || 'Assignment saved!')
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
    // Leisure and hotel-only movements are skipped — they carry no driver by definition.
    const target = items.filter(needsDriver).length
    setItems(is => is.map(x => needsDriver(x) ? { ...x, assignment } : x))
    const skipped = items.length - target
    toast.success(
      `${driver.name} set as driver for ${target} item${target !== 1 ? 's' : ''}`
      + (skipped > 0 ? ` (${skipped} no-driver day${skipped !== 1 ? 's' : ''} skipped)` : '')
      + ' — save to confirm',
    )
    setAssigningIdx(null)
  }

  function openAssignPanel(idx: number) {
    const existing = items[idx]?.assignment
    setAssigningIdx(idx)
    setDriverSearch('')
    setAssignMode(existing?.vendorId ? 'vendor' : 'driver')
    const vid = existing?.vendorId ?? ''
    setSelectedVendorId(vid)
    setVendorDrivers([])
    setVendorDriverForm({
      driverName:  existing?.driverName  ?? '',
      driverPhone: existing?.driverPhone ?? '',
      vehicleType: existing?.vehicleType ?? '',
      vehiclePlate: existing?.vehiclePlate ?? '',
    })
    setRateInput(existing?.driverRate != null ? String(existing.driverRate) : '')
    setRateCurrencyInput(existing?.rateCurrency ?? 'USD')
    setGuideSel({
      id:    existing?.guideId    ?? null,
      name:  existing?.guideName  ?? '',
      phone: existing?.guidePhone ?? '',
    })
    setTourVendorSel({
      id:    existing?.tourVendorId    ?? null,
      name:  existing?.tourVendorName  ?? '',
      phone: existing?.tourVendorPhone ?? '',
    })
    loadDriversForDate(items[idx]?.date ?? '')
    loadVendors()
    if (vid) loadVendorDrivers(vid)
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

  function fillFromItinerary() {
    if (!booking?.itineraryItems?.length) {
      toast.error('No itinerary data available for this booking')
      return
    }
    // Some imports store only the day number and leave the date null, which
    // would otherwise drop the whole entry — derive the date from the booking's
    // arrival date (day 1) so those entries still land on the right movement.
    const arrival = booking.arrivalDate?.slice(0, 10)
    const dateForDay = (dayNo: number) => {
      if (!arrival || !Number.isFinite(dayNo) || dayNo < 1) return ''
      const d = new Date(`${arrival}T00:00:00Z`)
      if (Number.isNaN(d.getTime())) return ''
      d.setUTCDate(d.getUTCDate() + (dayNo - 1))
      return d.toISOString().slice(0, 10)
    }

    // Group itinerary entries by date, preserving day order. A single date can
    // hold several movements (e.g. a departure transfer AND an arrival transfer),
    // so we must keep every entry — not collapse them into one description per date.
    const itinByDate = new Map<string, { title: string; description: string }[]>()
    for (const it of [...booking.itineraryItems].sort((a, b) => a.dayNo - b.dayNo)) {
      const d = it.date?.slice(0, 10) || dateForDay(it.dayNo)
      if (d && it.description?.trim()) {
        const list = itinByDate.get(d) ?? []
        list.push({ title: it.title ?? '', description: it.description.trim() })
        itinByDate.set(d, list)
      }
    }
    if (itinByDate.size === 0) {
      toast.error('No descriptions found in the itinerary')
      return
    }

    // Token-overlap score between an itinerary title and an agenda movement's
    // endpoints, so the right description lands on the right movement even when
    // several movements share a date or the agenda has been reordered.
    const tokenize = (s: string) =>
      new Set(
        (s || '')
          .toLowerCase()
          .replace(/[^a-z0-9 ]+/g, ' ')
          .split(/\s+/)
          .filter(t => t.length > 2),
      )
    const score = (title: string, item: AgendaItem) => {
      const itemTokens = tokenize(`${item.fromPoint} ${item.toPoint} ${item.location}`)
      let hits = 0
      tokenize(title).forEach(t => { if (itemTokens.has(t)) hits++ })
      return hits
    }

    // Track which itinerary entry (per date) has already been consumed so two
    // agenda movements on the same day don't both grab the same description.
    const used = new Map<string, Set<number>>()
    let replaced = 0

    const next = items.map(item => {
      const d = item.date?.slice(0, 10)
      if (!d) return item
      const candidates = itinByDate.get(d)
      if (!candidates?.length) return item

      const usedIdx = used.get(d) ?? new Set<number>()
      used.set(d, usedIdx)
      // Pick the best-scoring unused itinerary entry for this movement.
      let bestIdx = -1
      let bestScore = -1
      candidates.forEach((c, i) => {
        if (usedIdx.has(i)) return
        const sc = score(c.title, item)
        if (sc > bestScore) { bestScore = sc; bestIdx = i }
      })
      // Fall back to the first unused entry (positional order) if nothing matched.
      if (bestIdx === -1) {
        bestIdx = candidates.findIndex((_, i) => !usedIdx.has(i))
      }
      if (bestIdx === -1) return item

      usedIdx.add(bestIdx)
      replaced++
      return { ...item, details: candidates[bestIdx].description }
    })

    // A day can carry more itinerary entries than it has movements (two tours on
    // one day, one transfer row). Those leftovers used to be silently dropped —
    // append them to that day's last movement so the full day's text survives.
    const lastIdxByDate = new Map<string, number>()
    next.forEach((item, i) => {
      const d = item.date?.slice(0, 10)
      if (d) lastIdxByDate.set(d, i)
    })
    let appended = 0
    itinByDate.forEach((candidates, d) => {
      const target = lastIdxByDate.get(d)
      if (target === undefined) return
      const usedIdx = used.get(d) ?? new Set<number>()
      const leftovers = candidates.filter((_, i) => !usedIdx.has(i)).map(c => c.description)
      if (!leftovers.length) return
      const existing = next[target].details?.trim()
      next[target] = {
        ...next[target],
        details: [existing, ...leftovers].filter(Boolean).join('\n\n'),
      }
      appended += leftovers.length
    })

    setItems(next)
    toast.success(
      `Filled descriptions from itinerary (${replaced} item${replaced !== 1 ? 's' : ''} updated`
      + (appended ? `, ${appended} extra entr${appended !== 1 ? 'ies' : 'y'} appended` : '')
      + ')',
    )
  }

  function openDriverView(assignment: AgendaItem['assignment']) {
    setDriverModalTarget(assignment ?? {})
  }

  /**
   * Flip a movement between one of the two "no driver needed" marks — leisure
   * day (a free day) or hotel only (accommodation / the guest's own transport) —
   * and a normal serviced movement.
   *
   * Turning either on releases any driver already allocated and clears the other
   * mark: a movement carries one reason for having no driver, not two. Turning it
   * off puts the allocation controls back. Both marks feed the Sri Lanka Driver
   * Allocation board, which counts a file whose every movement is marked as
   * allocated rather than pending.
   */
  async function toggleNoDriver(idx: number, kind: 'leisure' | 'hotel') {
    const item = items[idx]
    if (!item) return

    const field    = kind === 'leisure' ? 'isLeisure' : 'isHotelOnly'
    const label    = kind === 'leisure' ? 'Leisure day' : 'Hotel only'
    const next     = !item[field]
    const previous = { isLeisure: item.isLeisure, isHotelOnly: item.isHotelOnly, assignment: item.assignment }

    setItems(is => is.map((x, j) => j === idx
      ? {
          ...x,
          isLeisure:   kind === 'leisure' ? next : (next ? false : x.isLeisure),
          isHotelOnly: kind === 'hotel'   ? next : (next ? false : x.isHotelOnly),
          assignment:  next ? null : x.assignment,
        }
      : x))
    if (next && assigningIdx === idx) setAssigningIdx(null)

    // Rows that have never been saved have no server id yet — the flag rides
    // along with the next full Save instead.
    if (!item.id) {
      toast.success(next ? `Marked as ${label.toLowerCase()} — save to confirm` : `${label} removed — save to confirm`)
      return
    }

    try {
      const res  = await fetch(`/api/bookings/${ref}/agenda`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, [field]: next }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(next
        ? `Marked as ${label.toLowerCase()} — no driver required`
        : `${label} removed — a driver can now be assigned`)
      if (!next && item.date) loadDriversForDate(item.date)
    } catch (err: unknown) {
      setItems(is => is.map((x, j) => j === idx ? { ...x, ...previous } : x))
      toast.error(err instanceof Error ? err.message : `Failed to update ${label.toLowerCase()}`)
    }
  }

  // Reorder a movement item from one position to another.
  // Each item keeps its OWN date — only the display order changes.
  function moveItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return
    setItems(prev => {
      if (from >= prev.length || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  // Insert a fresh movement item at a specific position (between two existing items,
  // or at the very top / bottom). The new item inherits the date & service type of the
  // item just above it so a "same-day" stop slots in without re-typing the date.
  function insertItemAt(index: number) {
    setItems(prev => {
      const above = prev[index - 1]
      const below = prev[index]
      const dateHint = above?.date || below?.date || ''
      const svcHint  = above?.serviceType || 'PVT_TRANSFER'
      const next = [...prev]
      next.splice(index, 0, {
        date: dateHint, location: '', fromPoint: above?.toPoint || '', toPoint: '',
        details: '', mealPlan: '', meetingTime: '', timeFrom: '', timeTo: '', serviceType: svcHint,
        isLeisure: false, isHotelOnly: false,
      })
      return next
    })
    // Keep any already-expanded detail editors open by shifting their indices past the insert
    setExpandedDetails(prev => {
      const shifted = new Set<number>()
      prev.forEach(x => shifted.add(x >= index ? x + 1 : x))
      return shifted
    })
    toast.success('New movement item inserted')
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

  const filteredVendors = vendors.filter(v =>
    v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    (v.phone && v.phone.includes(vendorSearch))
  )

  function toggleSection(key: string) {
    setExpandedSection(s => s === key ? null : key)
  }

  // Creative "insert here" affordance rendered between movement items. A thin line
  // that expands on hover to reveal an "Insert stop" pill — click to slot a new item
  // exactly at that position.
  function renderInsertZone(index: number) {
    if (!canEdit || generating) return null
    return (
      <div className="group relative -my-1 flex items-center justify-center py-1.5 transition-all">
        <div className="absolute inset-x-10 top-1/2 h-px bg-transparent group-hover:bg-brand-200 transition-colors" />
        <button
          type="button"
          onClick={() => insertItemAt(index)}
          title="Insert a movement item here"
          className="relative z-10 flex items-center gap-1.5 rounded-full border border-dashed border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-300 opacity-0 shadow-sm transition-all duration-200 hover:scale-105 group-hover:border-brand-400 group-hover:text-brand-600 group-hover:opacity-100"
        >
          <Plus className="w-3.5 h-3.5" /> Insert stop
        </button>
      </div>
    )
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <LogoSpinner size={48} label="Loading movement chart…" />
    </div>
  )

  return (
    <div>
      <Header
        title={`Movement Chart — ${ref}`}
        subtitle={generating ? 'Generating…' : `${items.length} item${items.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {/* PDF Download — all users, full details */}
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
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider px-4 pt-3 pb-1">Full Details</p>
                  <div className="border-t border-slate-100">
                    <button
                      onClick={() => { setShowPdfMenu(false); window.open(`/print/agenda/${ref}?drivers=true`, '_blank') }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-600 transition-colors"
                    >
                      <Eye className="w-4 h-4 text-slate-400" /> Download with all details
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Word Download */}
            <button
              onClick={downloadWord}
              disabled={downloadingWord}
              className="btn btn-secondary btn-sm flex items-center gap-1.5 disabled:opacity-60"
            >
              {downloadingWord ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Download Word
            </button>

            {/* WhatsApp — all users */}
            <button
              onClick={() => {
                setSendMode('whatsapp')
                setSendDrivers(true)
                // Prefer the booking's known WhatsApp/phone, then the lead passenger's contact.
                setSendTo(normalizeWhatsApp(
                  booking?.contactWhatsapp
                  || booking?.contactPhone
                  || booking?.passengers.find(p => p.isLead)?.contact
                  || ''
                ))
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
                setSendTo(booking?.contactEmail?.trim() ?? '')
                setSendMessage('')
                setSendSubject(`Tour Confirmation — ${ref}`)
                setSendModal(true)
              }}
              className="btn btn-sm bg-blue-600 text-white border border-blue-700 hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Send className="w-4 h-4" /> Email
            </button>

            {canEdit && (
              <>
                <button
                  onClick={fillFromItinerary}
                  className="btn btn-secondary btn-sm flex items-center gap-1.5"
                  title="Fill movement descriptions from itinerary raw data"
                >
                  <ClipboardList className="w-4 h-4" />
                  Get Raw Data
                </button>
                <div className="relative">
                  <Button variant="secondary" size="sm" loading={generating}
                    icon={<Wand2 className="w-4 h-4" />}
                    onClick={() => setShowUpload(v => !v)}>
                    AI Generate
                  </Button>
                  {showUpload && (
                    <div className="absolute right-0 top-10 z-20 w-80 bg-white border border-slate-200 rounded-xl shadow-lg p-4">
                      <p className="text-sm font-semibold text-slate-800 mb-1">Generate Movement Chart with AI</p>
                      <p className="text-xs text-slate-500 mb-3">
                        Upload a Travel Quotation or TC document — day topics, descriptions, and flight details are auto-extracted.
                      </p>
                      <input ref={fileInputRef} type="file" accept=".docx,.txt" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) generateFromFile(f); e.target.value = '' }} />
                      <div className="space-y-2">
                        <button onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center gap-2 p-3 rounded-lg border-2 border-dashed border-brand-200 hover:border-brand-400 hover:bg-brand-50 transition-colors text-sm font-medium text-brand-600">
                          <Upload className="w-4 h-4" />
                          <span>Upload Travel Quotation / TC (.docx)</span>
                        </button>
                        <button onClick={() => { setShowUpload(false); generateFromBooking() }}
                          className="w-full flex items-center gap-2 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors text-sm text-slate-600">
                          <Wand2 className="w-4 h-4" /> Generate from Booking Data (uses stored TQ itinerary)
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

        {/* ── THE CHART AS A MAP ──
            The rows below say what happens; this says where. Same data, read
            geographically — it catches the mistakes a table cannot show, like a
            drop-off point that is three hours from the next morning's pickup. */}
        <JourneyMap bookingRef={ref} source="agenda" />

        {/* ── BOOKING INFO PANELS ── */}
        {booking && (
          <div className="space-y-2">
            {/* Booking Details — key identifiers for the movement chart */}
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-brand-50 to-white border-b border-slate-100">
                <FileText className="w-4 h-4 text-brand-500" />
                <span className="text-sm font-semibold text-slate-800">Booking Details</span>
                {booking.operationCountry && (
                  <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <CountryFlag country={booking.operationCountry} className="w-4 h-3" />
                    {booking.tourDestination || ''}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 px-4 py-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5 flex items-center gap-1"><Hash className="w-3 h-3" /> Tour Ref</p>
                  <p className="text-sm font-mono font-bold text-slate-900">{booking.bookingRef}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">IS Number</p>
                  {booking.isNumber
                    ? <p className="text-sm font-mono font-semibold text-brand-600">{booking.isNumber}</p>
                    : <p className="text-sm text-slate-300">—</p>}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">CNTL No.</p>
                  {booking.cntlNumber
                    ? <p className="text-sm font-mono font-semibold text-violet-600">{booking.cntlNumber}</p>
                    : <p className="text-sm text-slate-300">—</p>}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5 flex items-center gap-1"><UserCheck className="w-3 h-3" /> Agent</p>
                  {booking.agent
                    ? <p className="text-sm font-semibold text-slate-800 truncate" title={booking.agent}>{booking.agent}</p>
                    : <p className="text-sm text-slate-300">—</p>}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Agent ID</p>
                  {booking.agentBookingId
                    ? <p className="text-sm font-mono text-slate-700">{booking.agentBookingId}</p>
                    : <p className="text-sm text-slate-300">—</p>}
                </div>
              </div>
            </Card>

            {/* Passengers */}
            {booking.passengers.length > 0 && (
              <Card className="overflow-hidden">
                <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                  <button
                    type="button"
                    onClick={() => toggleSection('passengers')}
                    className="flex items-center gap-2 text-left"
                  >
                    <Users className="w-4 h-4 text-brand-500" />
                    <span className="text-sm font-semibold text-slate-800">Passengers</span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-normal">
                      {booking.paxAdults} adult{booking.paxAdults !== 1 ? 's' : ''}{booking.paxChildren > 0 ? ` · ${booking.paxChildren} child${booking.paxChildren !== 1 ? 'ren' : ''}` : ''}{booking.paxInfants > 0 ? ` · ${booking.paxInfants} infant${booking.paxInfants !== 1 ? 's' : ''}` : ''}
                    </span>
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={openPassengerCountEditor}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 font-normal hover:text-brand-600 transition-colors ml-3"
                      aria-label="Edit passenger counts"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                  )}
                  {expandedSection === 'passengers' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </div>
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
                          <th className="px-4 py-2 text-left font-semibold">Meal Preference</th>
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
                            <td className="px-4 py-2.5 text-slate-500">
                              {p.mealPreference && p.mealPreference.trim() !== ''
                                ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">{p.mealPreference}</span>
                                : '—'}
                            </td>
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
           <Fragment key={i}>
            {/* Insert-between affordance (also covers inserting before the first item) */}
            {renderInsertZone(i)}
            <Card
              className={`overflow-hidden transition-all ${
                dragIndex === i ? 'opacity-40' : ''
              } ${
                dragOverIndex === i && dragIndex !== null && dragIndex !== i
                  ? 'ring-2 ring-brand-400 ring-offset-1' : ''
              }`}
            >
              <div
                className="flex"
                onDragOver={canEdit ? (e) => { e.preventDefault(); if (dragOverIndex !== i) setDragOverIndex(i) } : undefined}
                onDrop={canEdit ? (e) => {
                  e.preventDefault()
                  if (dragIndex !== null) moveItem(dragIndex, i)
                  setDragIndex(null); setDragOverIndex(null)
                } : undefined}
              >
                {canEdit && (
                  <div
                    draggable
                    onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                    title="Drag to reorder — dates stay with the position"
                    className="w-7 flex-shrink-0 flex items-center justify-center bg-slate-50 border-r border-slate-100 cursor-grab active:cursor-grabbing hover:bg-slate-100 transition-colors"
                  >
                    <GripVertical className="w-4 h-4 text-slate-300" />
                  </div>
                )}
                {(() => {
                  const strip = SERVICE_STRIP[item.serviceType]
                  return (
                    <div className={`w-9 flex-shrink-0 flex items-start justify-center pt-4 ${strip?.bg ?? 'bg-slate-200'}`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center ${strip?.iconBg ?? 'bg-slate-100'} ${strip?.iconColor ?? 'text-slate-500'}`}>
                        {strip ? <strip.icon className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                      </span>
                    </div>
                  )
                })()}

                <div className="flex-1 p-5">
                  {canEdit ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        <div>
                          <label className="form-label text-xs">Date</label>
                          {/* min/max keep the year to four digits — the browser
                              otherwise accepts a stray keystroke as year 82026,
                              which the database cannot store. */}
                          <input type="date" className="form-input text-sm py-1.5" value={item.date}
                            min="1900-01-01" max="2200-12-31"
                            onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} />
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
                        {isSicType(item.serviceType) && (
                          <>
                            <div>
                              <label className="form-label text-xs">Time From</label>
                              <input type="time" className="form-input text-sm py-1.5" value={item.timeFrom}
                                onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, timeFrom: e.target.value } : x))} />
                            </div>
                            <div>
                              <label className="form-label text-xs">Time To</label>
                              <input type="time" className="form-input text-sm py-1.5" value={item.timeTo}
                                onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, timeTo: e.target.value } : x))} />
                            </div>
                          </>
                        )}
                        <div>
                          <label className="form-label text-xs">Meal Plan</label>
                          <ComboInput
                            className="form-input text-sm py-1.5"
                            value={item.mealPlan}
                            onChange={v => setItems(is => is.map((x, j) => j === i ? { ...x, mealPlan: v } : x))}
                            options={MEAL_PLAN_OPTIONS}
                            placeholder="B / L / D / BL / BD / LD"
                          />
                        </div>

                        {/* Route & activity — given their own full-width band because
                            activity names for multi-attraction packages run long. */}
                        <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 mt-1 border-t border-slate-100">
                          <div>
                            <label className="form-label text-xs">Location</label>
                            <ComboInput className="form-input text-sm py-1.5" value={item.location}
                              options={routeOptions.location}
                              onChange={v => setItems(is => is.map((x, j) => j === i ? { ...x, location: v } : x))} />
                          </div>
                          <div>
                            <label className="form-label text-xs">From</label>
                            <ComboInput className="form-input text-sm py-1.5" value={item.fromPoint}
                              options={routeOptions.fromPoint}
                              onChange={v => setItems(is => is.map((x, j) => j === i ? { ...x, fromPoint: v } : x))} />
                          </div>

                          <div className="sm:col-span-2">
                            <div className="flex items-baseline justify-between mb-1">
                              <label className="form-label text-xs mb-0">To / Activity</label>
                              <span className={`text-[11px] tabular-nums ${item.toPoint.length > 400 ? 'text-amber-600' : 'text-slate-400'}`}>
                                {item.toPoint.length} chars
                              </span>
                            </div>
                            <ComboInput
                              multiline
                              className="form-textarea text-sm py-1.5 leading-relaxed"
                              value={item.toPoint}
                              options={routeOptions.toPoint}
                              onChange={v => setItems(is => is.map((x, j) => j === i ? { ...x, toPoint: v } : x))}
                              placeholder="Destination, or the full activity / package name — type anything; the list is only a shortcut"
                            />
                          </div>
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
                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                          {item.isHotelOnly ? (
                            <span className="flex items-center gap-2 text-xs bg-pink-50 border border-pink-200 rounded-lg px-3 py-2 text-pink-700 font-medium">
                              <Hotel className="w-3.5 h-3.5 text-pink-500" />
                              Hotel only — no driver required
                            </span>
                          ) : item.isLeisure ? (
                            <span className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700 font-medium">
                              <Palmtree className="w-3.5 h-3.5 text-amber-500" />
                              Leisure day — no driver required
                            </span>
                          ) : (item.assignment?.driverName || item.assignment?.vendorId) ? (
                            item.assignment.vendorId ? (
                              <div className="flex items-center gap-2 text-xs bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                                <Building2 className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                                <span className="font-semibold text-violet-700">{item.assignment.vendorName}</span>
                                {item.assignment.driverName ? (
                                  <>
                                    <span className="text-slate-400">·</span>
                                    <span className="font-medium text-slate-700">{item.assignment.driverName}</span>
                                  </>
                                ) : (
                                  <span className="text-violet-400 italic">Awaiting driver</span>
                                )}
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
                                onClick={() => openDriverView(item.assignment)}
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
                          {needsDriver(item) && <PartnerChips assignment={item.assignment} />}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <NoDriverButtons item={item} onToggle={kind => toggleNoDriver(i, kind)} />
                            {needsDriver(item) && (
                              <Button variant="secondary" size="sm" icon={<Car className="w-3.5 h-3.5" />}
                                onClick={() => openAssignPanel(i)}>
                                {(item.assignment?.driverName || item.assignment?.vendorId) ? 'Re-assign' : 'Assign Driver'}
                              </Button>
                            )}
                          </div>
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
                          {svcType && (
                            <Badge color={svcType.color}>
                              <span className="flex items-center gap-1">
                                <svcType.icon className="w-3 h-3" />
                                {svcType.label}
                              </span>
                            </Badge>
                          )}
                          {item.isLeisure && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                              <Palmtree className="w-3 h-3" />
                              Leisure Day
                            </span>
                          )}
                          {item.isHotelOnly && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 border border-pink-200">
                              <Hotel className="w-3 h-3" />
                              Hotel Only
                            </span>
                          )}
                          {/* Only show meal plan badge if it has a value */}
                          {normalizeMealPlan(item.mealPlan) && (
                            <Badge color="amber">{normalizeMealPlan(item.mealPlan)}</Badge>
                          )}
                          {item.meetingTime && (
                            <span className="text-xs text-slate-500">Meet: {item.meetingTime}</span>
                          )}
                          {isSicType(item.serviceType) && (item.timeFrom || item.timeTo) && (
                            <span className="text-xs text-slate-500">
                              {item.timeFrom && `From: ${item.timeFrom}`}{item.timeFrom && item.timeTo && ' · '}{item.timeTo && `To: ${item.timeTo}`}
                            </span>
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

                        {item.isLeisure && (
                          <div className="mt-2 flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 w-fit text-amber-700 font-medium">
                            <Palmtree className="w-3.5 h-3.5 text-amber-500" />
                            Leisure day — no driver required
                          </div>
                        )}

                        {item.isHotelOnly && (
                          <div className="mt-2 flex items-center gap-2 text-xs bg-pink-50 border border-pink-200 rounded-lg px-3 py-2 w-fit text-pink-700 font-medium">
                            <Hotel className="w-3.5 h-3.5 text-pink-500" />
                            Hotel only — no driver required
                          </div>
                        )}

                        {/* Allocated driver — clickable to view full info */}
                        {needsDriver(item) && (item.assignment?.driverName || item.assignment?.vendorId) && (
                          item.assignment.vendorId ? (
                            <div className="mt-2 flex items-center gap-2 text-xs bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 w-fit">
                              <Building2 className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                              <span className="font-semibold text-violet-700">{item.assignment.vendorName}</span>
                              {item.assignment.driverName ? (
                                <>
                                  <span className="text-slate-400">·</span>
                                  <span className="font-medium text-slate-700">{item.assignment.driverName}</span>
                                </>
                              ) : (
                                <span className="text-violet-400 italic">Awaiting driver</span>
                              )}
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
                              onClick={() => openDriverView(item.assignment)}
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

                        {needsDriver(item) && (item.assignment?.guideName || item.assignment?.tourVendorName) && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <PartnerChips assignment={item.assignment} />
                          </div>
                        )}
                      </div>
                      {canAssign && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <NoDriverButtons item={item} onToggle={kind => toggleNoDriver(i, kind)} />
                          {needsDriver(item) && (
                            <Button variant="secondary" size="sm" icon={<Car className="w-3.5 h-3.5" />}
                              onClick={() => openAssignPanel(i)}>
                              {(item.assignment?.driverName || item.assignment?.vendorId) ? 'Re-assign' : 'Assign Driver'}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
            </Card>
           </Fragment>
          )
        })}

        {canEdit && !generating && (
          <Button variant="secondary" icon={<Plus className="w-4 h-4" />}
            onClick={() => setItems(is => [...is, {
              date: '', location: '', fromPoint: '', toPoint: '',
              details: '', mealPlan: '', meetingTime: '', timeFrom: '', timeTo: '', serviceType: 'PVT_TRANSFER',
              isLeisure: false, isHotelOnly: false,
            }])}>
            Add Movement Item
          </Button>
        )}
      </div>

      {/* ── ASSIGN DRIVER / VENDOR MODAL ── */}
      {assigningIdx !== null && (
        <Modal
          open
          onClose={() => setAssigningIdx(null)}
          title="Assign Driver"
          size="2xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <div>
                {(items[assigningIdx]?.assignment?.driverName
                  || items[assigningIdx]?.assignment?.vendorId
                  || items[assigningIdx]?.assignment?.guideName
                  || items[assigningIdx]?.assignment?.tourVendorName) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const idx = assigningIdx
                      const it  = items[idx]
                      setGuideSel(EMPTY_SELECTION)
                      setTourVendorSel(EMPTY_SELECTION)
                      if (!it?.id) {
                        setItems(is => is.map((x, j) => j === idx ? { ...x, assignment: null } : x))
                        setAssigningIdx(null)
                        return
                      }
                      saveAssignment(it.id, idx, null)
                    }}
                  >
                    Remove Assignment
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setAssigningIdx(null)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const idx = assigningIdx
                    const it  = items[idx]
                    if (!it?.id) { toast.error('Save the agenda first before assigning'); return }

                    // The guide / tour-vendor pickers hold their own state, so
                    // their values are merged in here rather than in the item —
                    // both modes must carry them or switching tabs would drop
                    // a guide the user had already chosen.
                    const partnerFields = {
                      guideId:         guideSel.id,
                      guideName:       guideSel.name.trim()  || null,
                      guidePhone:      guideSel.phone.trim() || null,
                      tourVendorId:    tourVendorSel.id,
                      tourVendorName:  tourVendorSel.name.trim()  || null,
                      tourVendorPhone: tourVendorSel.phone.trim() || null,
                    }

                    let next: AgendaItem['assignment']
                    if (assignMode === 'vendor' && selectedVendorId) {
                      const vendor = vendors.find(v => v.id === selectedVendorId)
                      next = {
                        driverId:     null,
                        vendorId:     selectedVendorId,
                        vendorName:   vendor?.name ?? '',
                        driverName:   vendorDriverForm.driverName  || undefined,
                        driverPhone:  vendorDriverForm.driverPhone || undefined,
                        vehicleType:  vendorDriverForm.vehicleType || undefined,
                        vehiclePlate: vendorDriverForm.vehiclePlate || undefined,
                        driverRate:   rateInput ? Number(rateInput) : null,
                        rateCurrency: rateCurrencyInput || 'USD',
                        ...partnerFields,
                      }
                    } else {
                      next = { ...(it.assignment ?? {}), ...partnerFields }
                    }

                    // Nobody left on the movement — clear it rather than saving
                    // an empty row, which is also what releases a dropped driver.
                    const isEmpty = !next.driverId && !next.vendorId && !next.driverName
                      && !next.guideName && !next.tourVendorName
                    saveAssignment(it.id, idx, isEmpty ? null : next)
                  }}
                >
                  Save Assignment
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Availability check subtitle */}
            {items[assigningIdx]?.date && (
              <p className="text-xs text-slate-400 -mt-2">
                Availability check for <strong className="text-slate-600">{formatDate(items[assigningIdx].date)}</strong>
              </p>
            )}

            {/* ── Guide / tour vendor ──
                Shown only for countries Settings has switched them on for, and
                kept above the driver tabs because they apply to the movement
                whichever way transport is arranged. */}
            {(guidesEnabled || tourVendorsEnabled) && (
              <div className="space-y-2">
                {guidesEnabled && (
                  <PartnerAssignPicker
                    kind="guide" country={partnerCountry}
                    value={guideSel} onChange={setGuideSel}
                  />
                )}
                {tourVendorsEnabled && (
                  <PartnerAssignPicker
                    kind="tourVendor" country={partnerCountry}
                    value={tourVendorSel} onChange={setTourVendorSel}
                  />
                )}
              </div>
            )}

            {/* Mode tabs */}
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
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

            {/* Rate input */}
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
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
                {/* Driver search */}
                <div className="relative">
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
                        const idx        = assigningIdx
                        const isSelected = items[idx]?.assignment?.driverId === d.id
                        const isBusy     = d.isBusyOnDate ?? false
                        return (
                          <div key={d.id} className="space-y-1">
                            <button
                              onClick={() => setItems(is => is.map((x, j) => j === idx ? {
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
                                isBusy     ? 'bg-red-50 border border-red-200 hover:bg-red-100' :
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
                            {isSelected && (
                              <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-3">
                                {/* Driver header with photo */}
                                <div className="flex items-start gap-3">
                                  <button
                                    type="button"
                                    onClick={() => d.photoUrl && setPhotoLightbox({ url: d.photoUrl, label: `${d.name} — Driver` })}
                                    className={`w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-blue-100 flex items-center justify-center ${d.photoUrl ? 'cursor-zoom-in hover:ring-2 hover:ring-brand-400' : ''}`}
                                  >
                                    {d.photoUrl
                                      ? <img src={d.photoUrl} alt={d.name} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                                      : <span className="font-bold text-lg text-blue-700">{d.name.slice(0, 1)}</span>}
                                  </button>
                                  <div className="flex-1 min-w-0 text-xs space-y-0.5">
                                    <p className="font-semibold text-sm text-slate-800">{d.name}</p>
                                    <p className="text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" /> {d.phone}</p>
                                    {d.email && <p className="text-slate-500 flex items-center gap-1"><Mail className="w-3 h-3" /> {d.email}</p>}
                                    {d.licenseNo && <p className="text-slate-500">🪪 License: {d.licenseNo}</p>}
                                  </div>
                                </div>

                                {/* Vehicle details */}
                                {d.vehicle ? (
                                  <div className="rounded-lg bg-white border border-slate-200 p-2.5 space-y-2">
                                    <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> Vehicle</p>
                                    <div className="text-xs text-slate-700 space-y-0.5">
                                      <p className="font-medium">{[d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ') || d.vehicle.type}</p>
                                      <p className="text-slate-500">
                                        {d.vehicle.type}
                                        {d.vehicle.plateNo && ` · ${d.vehicle.plateNo}`}
                                        {d.vehicle.capacity ? ` · ${d.vehicle.capacity} seats` : ''}
                                      </p>
                                      {d.vehicle.vendor?.name && <p className="text-slate-500">Fleet: {d.vehicle.vendor.name}</p>}
                                      {d.vehicle.description && <p className="text-slate-400">{d.vehicle.description}</p>}
                                    </div>
                                    {(d.vehicle.photoOutside || d.vehicle.photoInside) && (
                                      <div className="flex gap-2">
                                        {d.vehicle.photoOutside && (
                                          <button
                                            type="button"
                                            onClick={() => setPhotoLightbox({ url: d.vehicle!.photoOutside!, label: `${d.name} — Vehicle (Outside)` })}
                                            className="relative w-24 h-16 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 cursor-zoom-in hover:ring-2 hover:ring-brand-400"
                                          >
                                            <img src={d.vehicle.photoOutside} alt="Vehicle outside" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                                            <span className="absolute bottom-0 inset-x-0 text-[9px] text-white bg-black/50 text-center">Outside</span>
                                          </button>
                                        )}
                                        {d.vehicle.photoInside && (
                                          <button
                                            type="button"
                                            onClick={() => setPhotoLightbox({ url: d.vehicle!.photoInside!, label: `${d.name} — Vehicle (Inside)` })}
                                            className="relative w-24 h-16 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 cursor-zoom-in hover:ring-2 hover:ring-brand-400"
                                          >
                                            <img src={d.vehicle.photoInside} alt="Vehicle inside" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                                            <span className="absolute bottom-0 inset-x-0 text-[9px] text-white bg-black/50 text-center">Inside</span>
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-400 italic">No vehicle assigned to this driver</p>
                                )}
                              </div>
                            )}
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
                {/* Vendor list with search */}
                <div>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      value={vendorSearch}
                      onChange={e => setVendorSearch(e.target.value)}
                      placeholder="Search vendors…"
                      className="form-input pl-9 text-sm py-2"
                    />
                  </div>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {filteredVendors.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-4">No vendors found</p>
                    ) : (
                      filteredVendors.map(v => {
                        const isVendorSelected = selectedVendorId === v.id
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              setSelectedVendorId(v.id)
                              setVendorDriverForm({ driverName: '', driverPhone: '', vehicleType: '', vehiclePlate: '' })
                              loadVendorDrivers(v.id)
                            }}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                              isVendorSelected
                                ? 'bg-brand-50 border-2 border-brand-300'
                                : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                            }`}
                          >
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isVendorSelected ? 'bg-brand-100' : 'bg-violet-100'}`}>
                              <span className={`font-bold text-sm ${isVendorSelected ? 'text-brand-700' : 'text-violet-700'}`}>{v.name.slice(0, 1)}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-slate-800">{v.name}</p>
                              <p className="text-xs text-slate-500">{v.phone ?? '—'}{v.country ? ` · ${v.country}` : ''}</p>
                            </div>
                            {isVendorSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Vendor's registered drivers */}
                {selectedVendorId && (
                  <div>
                    <label className="form-label text-xs">Select Driver (from vendor fleet)</label>
                    {loadingVendorDrivers ? (
                      <div className="flex items-center gap-2 py-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                        <span className="text-xs text-slate-400">Loading drivers…</span>
                      </div>
                    ) : vendorDrivers.length > 0 ? (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {vendorDrivers.map(d => {
                          const isSelected = vendorDriverForm.driverName === d.name && vendorDriverForm.driverPhone === d.phone
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => setVendorDriverForm({
                                driverName:   d.name,
                                driverPhone:  d.phone,
                                vehicleType:  d.vehicle?.type    ?? '',
                                vehiclePlate: d.vehicle?.plateNo ?? '',
                              })}
                              className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left text-sm transition-all ${
                                isSelected
                                  ? 'bg-brand-50 border-2 border-brand-300'
                                  : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                              }`}
                            >
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-brand-100' : 'bg-blue-100'}`}>
                                <span className={`font-bold text-xs ${isSelected ? 'text-brand-700' : 'text-blue-700'}`}>{d.name.slice(0,1)}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-slate-800 text-sm">{d.name}</p>
                                <p className="text-xs text-slate-500">{d.phone}{d.vehicle ? ` · ${d.vehicle.type} ${d.vehicle.plateNo}` : ''}</p>
                              </div>
                              {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 py-1 italic">No registered drivers for this vendor — enter details manually below</p>
                    )}
                  </div>
                )}

                {/* Manual driver details */}
                <div>
                  <label className="form-label text-xs">{selectedVendorId && vendorDrivers.length > 0 ? 'Override / Manual Entry' : 'Driver Details'}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="form-label text-xs">Driver Name</label>
                      <input className="form-input text-sm py-1.5" placeholder="Driver full name"
                        value={vendorDriverForm.driverName}
                        onChange={e => setVendorDriverForm(f => ({ ...f, driverName: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label text-xs">Driver Phone</label>
                      <input className="form-input text-sm py-1.5" placeholder="+94 …"
                        value={vendorDriverForm.driverPhone}
                        onChange={e => setVendorDriverForm(f => ({ ...f, driverPhone: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label text-xs">Vehicle Type</label>
                      <input className="form-input text-sm py-1.5" placeholder="Van, Bus, Car…"
                        value={vendorDriverForm.vehicleType}
                        onChange={e => setVendorDriverForm(f => ({ ...f, vehicleType: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label text-xs">Plate No</label>
                      <input className="form-input text-sm py-1.5 font-mono" placeholder="CA-1234"
                        value={vendorDriverForm.vehiclePlate}
                        onChange={e => setVendorDriverForm(f => ({ ...f, vehiclePlate: e.target.value }))} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── DRIVER / VEHICLE PHOTO LIGHTBOX ── */}
      {photoLightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPhotoLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setPhotoLightbox(null)}
          >
            <X className="w-5 h-5" />
          </button>
          <div className="max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <img src={photoLightbox.url} alt={photoLightbox.label} className="w-full max-h-[80vh] object-contain rounded-xl" />
            <p className="text-center text-white/80 text-sm mt-3">{photoLightbox.label}</p>
          </div>
        </div>
      )}

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
              onClick={() => { setSendMode('whatsapp'); setSendTo(prev => normalizeWhatsApp(prev)) }}
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

          {/* Attachment format */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <p className="text-sm font-semibold text-slate-800">Attachment Format</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {sendFormat === 'word'
                  ? 'Sends the editable .docx movement chart'
                  : 'Sends the print-ready PDF movement chart'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSendFormat('pdf')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${sendFormat === 'pdf' ? 'bg-rose-500 text-white border-rose-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
              >
                <FileText className="w-3 h-3 inline mr-1" />PDF
              </button>
              <button
                onClick={() => setSendFormat('word')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${sendFormat === 'word' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
              >
                <FileType className="w-3 h-3 inline mr-1" />Word
              </button>
            </div>
          </div>

          {/* Driver toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <p className="text-sm font-semibold text-slate-800">Include Driver Allocation</p>
              <p className="text-xs text-slate-400 mt-0.5">Show driver names, phones, and vehicle info in the {sendFormat === 'word' ? 'document' : 'PDF'}</p>
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
              onChange={e => setSendTo(sendMode === 'whatsapp' ? normalizeWhatsApp(e.target.value) : e.target.value)}
            />
          </div>

          {/* Subject (email only) */}
          {sendMode === 'email' && (
            <div>
              <label className="form-label text-xs">Subject</label>
              <input
                className="form-input"
                placeholder={`Tour Confirmation — ${ref}`}
                value={sendSubject}
                onChange={e => setSendSubject(e.target.value)}
              />
            </div>
          )}

          {/* Message */}
          <div>
            <label className="form-label text-xs">
              {sendMode === 'email' ? 'Extra note (optional)' : 'Message (optional)'}
            </label>
            <textarea
              className="form-textarea resize-none text-sm"
              rows={3}
              value={sendMessage}
              onChange={e => setSendMessage(e.target.value)}
              placeholder={sendMode === 'email'
                ? 'Added on top of the standard tour confirmation message…'
                : `Add a custom message to include with the agenda ${sendFormat === 'word' ? 'Word file' : 'PDF'}…`}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button loading={sending} onClick={sendAgenda} className="flex-1">
              <Send className="w-4 h-4" />
              {sending ? 'Sending…' : `Send ${sendFormat === 'word' ? 'Word' : 'PDF'} via ${sendMode === 'whatsapp' ? 'WhatsApp' : 'Email'}`}
            </Button>
            <Button variant="ghost" onClick={() => setSendModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* ── DRIVER / VENDOR VIEW MODAL ── */}
      <DriverVendorModal
        open={driverModalTarget !== null}
        onClose={() => setDriverModalTarget(null)}
        driverId={driverModalTarget?.driverId}
        vendorId={driverModalTarget?.vendorId}
        fallback={{
          driverName:   driverModalTarget?.driverName,
          driverPhone:  driverModalTarget?.driverPhone,
          vehicleType:  driverModalTarget?.vehicleType,
          vehiclePlate: driverModalTarget?.vehiclePlate,
          vendorName:   driverModalTarget?.vendorName,
        }}
      />

      <Modal
        open={editPassengersModal}
        onClose={() => setEditPassengersModal(false)}
        title="Edit Passenger Counts"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditPassengersModal(false)}>Cancel</Button>
            <Button loading={savingPassengers} onClick={savePassengerCounts}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Update the passenger summary shown on the agenda and in exported documents.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Adults</span>
              <input
                type="number"
                min="0"
                step="1"
                value={editingPaxAdults}
                onChange={e => setEditingPaxAdults(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Children</span>
              <input
                type="number"
                min="0"
                step="1"
                value={editingPaxChildren}
                onChange={e => setEditingPaxChildren(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Infants</span>
              <input
                type="number"
                min="0"
                step="1"
                value={editingPaxInfants}
                onChange={e => setEditingPaxInfants(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>
        </div>
      </Modal>
    </div>
  )
}
