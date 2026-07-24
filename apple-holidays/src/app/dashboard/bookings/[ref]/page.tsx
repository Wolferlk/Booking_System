'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Users, Plane, Hotel, MapPin, FileText, CreditCard,
  AlertCircle, Clock, Loader2, Save,
  ChevronRight, Calendar, ArrowLeft, TrendingUp, Ticket,
  Phone, Shield, Edit2, UserCheck, MessageCircle, Send, Plus, Trash2, Mail, Copy,
  FlaskConical, Globe, Sparkles, PlaneLanding,
  History, ChevronDown, RotateCcw, Wand2,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { formatDate, formatDateTime, formatCurrency, getDaysUntilTrip, readApiResponse, cn } from '@/lib/utils'
import { CountryFlag, FlagByCode } from '@/components/ui/country-flag'
import { countryLabel } from '@/lib/country-detection'
import { getAvailableTransitions, STATUS_LABELS } from '@/lib/state-machine'
import type { UserRole, BookingStatus } from '@prisma/client'
import Link from 'next/link'
import WhatsAppMiniChat from '@/components/bookings/whatsapp-mini-chat'
import BookingQCPanel from '@/components/bookings/booking-qc-panel'
import OneDriveFiles from '@/components/bookings/onedrive-files'
import ExternalPnlPanel from '@/components/bookings/external-pnl-panel'
import DriverLogPanel from '@/components/bookings/driver-log-panel'
import OneDriveFolderPicker from '@/components/bookings/onedrive-folder-picker'
import CloudFilePicker, { type CloudFile } from '@/components/shared/cloud-file-picker'
import TravellerExperiencePanel from '@/components/bookings/traveller-experience-panel'
import BookingCallTranscripts from '@/components/bookings/booking-call-transcripts'
import AICallsFeedbackModal from '@/components/bookings/ai-calls-feedback-modal'
import CustomerWhatsappPanel from '@/components/bookings/customer-whatsapp-panel'
import AiAutofillModal from '@/components/bookings/ai-autofill-modal'
import { buildEmergencyContactsBlock } from '@/lib/emergency-contacts'

/**
 * Detects whether an accommodation is the customer's OWN arrangement (booked by
 * the guest / agent themselves, not by Apple Holidays). We infer this from the
 * text fields the TC extraction fills in — hotels marked "own arrangement",
 * "self booked", "TBA", or with no hotel name are treated as own-arrangement.
 */
function isOwnArrangement(a: Record<string, unknown>): boolean {
  const hay = [a.hotel, a.roomType, a.mealType, a.address, a.contact]
    .map(v => String(v ?? '').toLowerCase())
    .join(' | ')
  if (/own\s*arrangement|self[\s-]*book|guest\s*arrang|by\s*guest|not\s*included|own\s*acc/.test(hay)) return true
  const hotel = String(a.hotel ?? '').trim().toLowerCase()
  if (!hotel || ['tba', 'tbc', 'n/a', 'na', 'to be advised', 'to be confirmed', '-'].includes(hotel)) return true
  return false
}

/** Shapes returned by the three `/extract` endpoints behind the AI Auto-fill popups. */
type ExtractedFlight = {
  flightNo: string; date: string; fromApt: string; depTime: string
  toApt: string; arrTime: string; airline: string; notes: string
}
type ExtractedPassenger = {
  name: string; type: string; age: number | string | null
  passport: string; nationality: string; contact: string
}
type ExtractedAccommodation = {
  hotel: string; city: string; checkIn: string; checkOut: string
  roomType: string; mealType: string; contact: string; address: string
}

/** Pre-filled reason when the file handler cancels without typing their own. */
const DEFAULT_CANCEL_REASON = 'File handler cancelled this booking'

/** Roles allowed to cancel — kept in step with the cancel API route. */
const CAN_CANCEL_ROLES: string[] = ['BT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export default function BookingDetailPage() {
  const { ref } = useParams<{ ref: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const role = (session?.user?.role ?? '') as UserRole

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [booking, setBooking] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [changeModal, setChangeModal] = useState(false)
  const [cancelModal, setCancelModal] = useState(false)
  const [note, setNote] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [pendingAction, setPendingAction] = useState<string>('')
  const [editAccomModal, setEditAccomModal] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [accomEdits, setAccomEdits] = useState<Record<string, any>>({})
  const [deletedAccomIds, setDeletedAccomIds] = useState<string[]>([])
  const [newAccoms, setNewAccoms] = useState<{ city: string; hotel: string; checkIn: string; checkOut: string; roomType: string; mealType: string; contact: string; address: string }[]>([])
  const [savingAccom, setSavingAccom] = useState(false)
  const [editPassengerModal, setEditPassengerModal] = useState(false)
  const [passengerEditList, setPassengerEditList] = useState<PassengerEditRow[]>([])
  const [savingPassengers, setSavingPassengers] = useState(false)
  const [editBookingModal, setEditBookingModal] = useState(false)
  const [bookingForm, setBookingForm] = useState({
    agent: '', fileHandler: '', agentBookingId: '',
    arrivalDate: '', departureDate: '',
    paxAdults: '2', paxChildren: '0', paxInfants: '0',
    quotedTotal: '', currency: 'USD',
    terms: '', exclusions: '', policyNotes: '', amendmentNote: '',
    valueAddedServices: '', packageIncludes: '', packageExcludes: '',
    importantNotes: '', tips: '', otherNote: '', clientRequest: '',
  })
  const [savingBooking, setSavingBooking] = useState(false)

  type FlightEntry = {
    _key: string; _isNew: boolean; _deleted: boolean
    id: string; flightNo: string; date: string
    fromApt: string; depTime: string; toApt: string; arrTime: string
    airline: string; notes: string
  }
  type PassengerEditRow = {
    _key: string; _isNew: boolean; _deleted: boolean
    id: string; name: string; type: string; age: string
    passport: string; nationality: string; contact: string; isLead: boolean
  }
  const [editFlightModal, setEditFlightModal] = useState(false)
  const [flightEditList, setFlightEditList] = useState<FlightEntry[]>([])
  const [flightChangeReason, setFlightChangeReason] = useState('')
  const [savingFlights, setSavingFlights] = useState(false)

  // Flight extraction from image/PDF
  const [flightScanLoading, setFlightScanLoading] = useState(false)
  const [flightDrivePickerOpen, setFlightDrivePickerOpen] = useState(false)

  // AI Auto-fill popups — one per detail card (passengers / flights / hotels)
  const [aiPassengerOpen, setAiPassengerOpen] = useState(false)
  const [aiFlightOpen, setAiFlightOpen] = useState(false)
  const [aiAccomOpen, setAiAccomOpen] = useState(false)

  const [waModal, setWaModal] = useState(false)
  const [waPhone, setWaPhone] = useState('')
  const [waMessage, setWaMessage] = useState('')
  const [waAttachPdf, setWaAttachPdf] = useState(true)
  const [waSending, setWaSending] = useState(false)
  const [waOpenerSending, setWaOpenerSending] = useState(false)
  const [waPdfType, setWaPdfType] = useState<'confirmation' | 'full'>('confirmation')
  const [waQueue, setWaQueue] = useState<Array<{ id: string; phone: string; preview: string; pdfType: string | null; queuedBy: string | null; queuedAt: string }>>([])

  // Email send modal
  const [emailModal, setEmailModal] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailCc, setEmailCc] = useState<string[]>([])
  const [emailSending, setEmailSending] = useState(false)

  // Test mode setting (loaded when email/wa modal opens)
  const [testMode, setTestMode] = useState<boolean>(false)
  const [testSettings, setTestSettings] = useState({ testEmail1: 'sasiofficial25@gmail.com', testEmail2: 'sasindu@aahaas.com', testWhatsapp: '94778231121' })

  // QC auto-send
  const [qcAutoSending, setQcAutoSending] = useState(false)

  // Customer origin (where the customer travelled FROM) — AI/flight derived
  type CustomerOrigin = { country: string; iso2: string; city: string | null; confidence: 'high' | 'medium' | 'low'; reasoning: string; detectedAt?: string }
  const [origin, setOrigin] = useState<CustomerOrigin | null>(null)
  const [originLoading, setOriginLoading] = useState(false)

  // Whether an Accounts (external) PNL record is linked to this booking.
  // Drives the "P&L Added" step in the Operation Checklist — it goes green as
  // soon as the Accounts PNL is connected, not only when an internal P&L exists.
  const [extPnlLinked, setExtPnlLinked] = useState(false)

  // Meal preference inline editing
  const [mealPrefs, setMealPrefs] = useState<Record<string, string>>({})
  const [mealPrefsDirty, setMealPrefsDirty] = useState(false)
  const [savingMealPrefs, setSavingMealPrefs] = useState(false)
  const [expandedMeal, setExpandedMeal] = useState<Set<string>>(new Set())

  // Version switching (V1 / V2 …)
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null)
  const [restoringVersion, setRestoringVersion] = useState(false)

  // AI Calls & Feedback modal
  const [aiCallsModal, setAiCallsModal] = useState(false)

  // Customer feedback modal (triggered on Complete Trip)
  const [feedbackModal, setFeedbackModal] = useState(false)
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackComment, setFeedbackComment] = useState('')
  const [feedbackSaving, setFeedbackSaving] = useState(false)

  // Contact info editing
  const [editContactModal, setEditContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ agentEmail: '', agentPhone: '', agentWhatsapp: '', agentAddress: '', contactEmail: '', contactPhone: '', contactWhatsapp: '', contactAddress: '' })
  const [savingContact, setSavingContact] = useState(false)

  // OneDrive folder assignment
  const [folderEditOpen, setFolderEditOpen] = useState(false)
  const [savingFolder, setSavingFolder] = useState(false)

  // TC identifier inline editing (IS Number / Reference Number / Tour Ref)
  const [tcEditOpen,    setTcEditOpen]    = useState(false)
  const [tcEditForm,    setTcEditForm]    = useState({ isNumber: '', agentBookingId: '', cntlNumber: '', bookingRef: '' })
  const [tcEditSaving,  setTcEditSaving]  = useState(false)

  async function saveTcIdentifiers() {
    setTcEditSaving(true)
    try {
      const body: Record<string, string | null> = {}
      if (tcEditForm.isNumber.trim() !== (booking?.isNumber ?? ''))
        body.isNumber = tcEditForm.isNumber.trim() || null
      if (tcEditForm.agentBookingId.trim() !== (booking?.agentBookingId ?? ''))
        body.agentBookingId = tcEditForm.agentBookingId.trim() || null
      if (tcEditForm.cntlNumber.trim() !== (booking?.cntlNumber ?? ''))
        body.cntlNumber = tcEditForm.cntlNumber.trim() || null
      // bookingRef edit only for super admins — include only if changed
      const isSA = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
      if (isSA && tcEditForm.bookingRef.trim() && tcEditForm.bookingRef.trim() !== ref)
        body.bookingRef = tcEditForm.bookingRef.trim()
      if (Object.keys(body).length === 0) { setTcEditOpen(false); return }
      const res = await fetch(`/api/bookings/${ref}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Identifiers updated')
      await load()
      setTcEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setTcEditSaving(false)
    }
  }

  async function saveFolder(url: string | null) {
    setSavingFolder(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: url || null }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setBooking((prev: any) => ({ ...prev, onedriveFolderUrl: url || null }))
      setFolderEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save folder')
    } finally {
      setSavingFolder(false)
    }
  }

  async function loadTestMode() {
    try {
      const res = await fetch('/api/admin/settings')
      const json = await res.json()
      if (json.success) {
        const d = json.data as Record<string, string>
        const mode = d['use_test_data'] === 'true'
        const settings = {
          testEmail1:   d['test_email_1']  ?? 'sasiofficial25@gmail.com',
          testEmail2:   d['test_email_2']  ?? 'sasindu@aahaas.com',
          testWhatsapp: d['test_whatsapp'] ?? '94778231121',
        }
        setTestMode(mode)
        setTestSettings(settings)
        return { mode, settings }
      }
    } catch { /* ignore */ }
    return { mode: false, settings: testSettings }
  }

  async function load() {
    try {
      const res = await fetch(`/api/bookings/${ref}`)
      const json = await res.json()
      if (json.success) setBooking(json.data)
      else toast.error('Booking not found')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); loadWaQueue() }, [ref])

  async function restoreVersion(versionNo: number) {
    setRestoringVersion(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/versions/${versionNo}/restore`, { method: 'POST' })
      const json = await res.json()
      if (json.success) {
        toast.success(`Switched to version V${versionNo}`)
        setRestoreTarget(null)
        setVersionMenuOpen(false)
        await load()
      } else {
        toast.error(json.error || 'Failed to switch version')
      }
    } catch {
      toast.error('Failed to switch version')
    } finally {
      setRestoringVersion(false)
    }
  }

  // Load any previously-detected customer origin from cache — and auto-detect
  // once if nothing has been detected yet, so the card fills in on open.
  useEffect(() => {
    let active = true
    fetch(`/api/bookings/${ref}/origin`)
      .then(r => r.json())
      .then(j => {
        if (!active) return
        if (j.success && j.data) setOrigin(j.data)
        else detectOrigin(true) // no cache yet → detect silently in the background
      })
      .catch(() => { /* non-critical */ })
    return () => { active = false }
  }, [ref])

  // Is an Accounts (external) PNL record linked? Used by the Operation Checklist.
  useEffect(() => {
    let active = true
    fetch(`/api/bookings/${ref}/ext-pnl`)
      .then(r => r.json())
      .then(j => { if (active) setExtPnlLinked(!!(j.success && j.data)) })
      .catch(() => { /* non-critical */ })
    return () => { active = false }
  }, [ref])

  // detectOrigin(auto): `auto` runs silently on page open (no toasts); the
  // Re-detect button calls it with auto=false to surface success/errors.
  async function detectOrigin(auto = false) {
    setOriginLoading(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/origin`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Detection failed')
      setOrigin(json.data)
      if (!auto) toast.success(`Origin detected: ${json.data.country}`)
    } catch (err) {
      if (!auto) toast.error(err instanceof Error ? err.message : 'Origin detection failed')
    } finally {
      setOriginLoading(false)
    }
  }

  useEffect(() => {
    if (booking) {
      setContactForm({
        agentEmail:     String(booking.agentEmail     ?? ''),
        agentPhone:     String(booking.agentPhone     ?? ''),
        agentWhatsapp:  String(booking.agentWhatsapp  ?? ''),
        agentAddress:   String(booking.agentAddress   ?? ''),
        contactEmail:   String(booking.contactEmail   ?? ''),
        contactPhone:   String(booking.contactPhone   ?? ''),
        contactWhatsapp: String(booking.contactWhatsapp ?? ''),
        contactAddress: String(booking.contactAddress ?? ''),
      })
      // Initialise meal preference map from loaded passengers
      const prefs: Record<string, string> = {}
      for (const p of (booking.passengers ?? [])) {
        prefs[p.id as string] = (p.mealPreference as string) ?? ''
      }
      setMealPrefs(prefs)
      setMealPrefsDirty(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking])

  async function doTransition(endpoint: string, body: Record<string, unknown> = {}) {
    setActionLoading(endpoint)
    try {
      const res = await fetch(`/api/bookings/${ref}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Action completed')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
    </div>
  )

  if (!booking) return (
    <div className="flex flex-col items-center justify-center h-screen">
      <p className="text-slate-500">Booking not found</p>
      <button onClick={() => router.back()} className="mt-4 text-brand-600 hover:underline text-sm">Go back</button>
    </div>
  )

  const status = booking.status as BookingStatus
  const isCancelled = status === 'CANCELLED'
  const isPendingCancel = status === 'PENDING_CANCELLATION'
  const transitions = getAvailableTransitions(status, role)
  const daysUntil = getDaysUntilTrip(booking.arrivalDate as string)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passengers: any[] = booking.passengers ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flights: any[] = booking.flights ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accommodations: any[] = booking.accommodations ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itinerary: any[] = booking.itineraryItems ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const changeRequests: any[] = booking.changeRequests ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statusEvents: any[] = booking.statusEvents ?? []
  const pnl = booking.pnl ?? null
  // Manual customer feedback recorded by the TE team on Complete Trip / Get Feedback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerFeedback: any = booking.customerFeedback ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emergencyContacts: any[] = booking.emergencyContacts ?? []
  // Client numbers come first (WhatsApp target = customer only)
  // Agent numbers listed last, labeled as not recommended for WhatsApp
  const availablePhones: { label: string; value: string }[] = [
    booking.contactWhatsapp ? { label: `✓ Customer WhatsApp: ${booking.contactWhatsapp}`, value: String(booking.contactWhatsapp) } : null,
    booking.contactPhone    ? { label: `✓ Customer Phone: ${booking.contactPhone}`,    value: String(booking.contactPhone) }    : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...passengers.filter((p: any) => p.contact).map((p: any) => ({ label: `✓ ${p.name as string}: ${p.contact as string}`, value: p.contact as string })),
    booking.agentWhatsapp   ? { label: `— Agent WhatsApp (not for WA): ${booking.agentWhatsapp}`,  value: String(booking.agentWhatsapp) }  : null,
    booking.agentPhone      ? { label: `— Agent Phone (not for WA): ${booking.agentPhone}`,         value: String(booking.agentPhone) }      : null,
  ].filter((x): x is { label: string; value: string } => x !== null)

  const availableEmails: { label: string; value: string }[] = [
    booking.agentEmail ? { label: `Agent: ${booking.agentEmail}`, value: String(booking.agentEmail) } : null,
    booking.contactEmail ? { label: `Customer: ${booking.contactEmail}`, value: String(booking.contactEmail) } : null,
  ].filter((x): x is { label: string; value: string } => x !== null)

  const canViewClientDetails = ['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canEditBooking = ['GT_USER', 'GT_TE_USER', 'BT_USER', 'TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  const canEditFlights = ['TE_USER', 'GT_TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  function openEditFlight() {
    setFlightEditList(
      (booking.flights ?? []).map((f: Record<string, unknown>, i: number) => ({
        _key: String(f.id ?? i),
        _isNew: false,
        _deleted: false,
        id: String(f.id ?? ''),
        flightNo: String(f.flightNo ?? ''),
        date: f.date ? String(f.date).slice(0, 10) : '',
        fromApt: String(f.fromApt ?? ''),
        depTime: String(f.depTime ?? ''),
        toApt: String(f.toApt ?? ''),
        arrTime: String(f.arrTime ?? ''),
        airline: String(f.airline ?? ''),
        notes: String(f.notes ?? ''),
      }))
    )
    setFlightChangeReason('')
    setEditFlightModal(true)
  }

  function updateFlight(key: string, field: string, value: string) {
    setFlightEditList(prev => prev.map(f => f._key === key ? { ...f, [field]: value } : f))
  }

  function addNewFlight() {
    const key = `new-${Date.now()}`
    setFlightEditList(prev => [...prev, {
      _key: key, _isNew: true, _deleted: false,
      id: '', flightNo: '', date: '', fromApt: '', depTime: '',
      toApt: '', arrTime: '', airline: '', notes: '',
    }])
  }

  function removeFlight(key: string) {
    setFlightEditList(prev => prev.map(f => f._key === key ? { ...f, _deleted: true } : f))
  }

  async function saveFlightEdits() {
    if (!flightChangeReason.trim()) { toast.error('Please provide a reason for the change'); return }
    setSavingFlights(true)
    try {
      const active = flightEditList.filter(f => !f._deleted)
      const deleted = flightEditList.filter(f => f._deleted && !f._isNew)

      const flightUpdates = active.filter(f => !f._isNew).map(({ id, flightNo, date, fromApt, depTime, toApt, arrTime, airline, notes }) => ({
        id, flightNo, date, fromApt, depTime, toApt, arrTime, airline, notes,
      }))
      const flightAdds = active.filter(f => f._isNew).map(({ flightNo, date, fromApt, depTime, toApt, arrTime, airline, notes }) => ({
        flightNo, date, fromApt, depTime, toApt, arrTime, airline, notes,
      }))
      const flightDeletes = deleted.map(f => f.id)

      const res = await fetch(`/api/bookings/${ref}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flightUpdates,
          flightAdds,
          flightDeletes,
          amendmentNote: flightChangeReason,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Flight details updated')
      setEditFlightModal(false)
      setFlightChangeReason('')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSavingFlights(false) }
  }

  /**
   * Merges AI-extracted flight segments into the flight edit form as new rows
   * and opens it, so nothing is written until the handler reviews and saves.
   */
  function applyExtractedFlights(extracted: ExtractedFlight[]) {
    if (extracted.length === 0) { toast.info('No flight segments found'); return }
    const newEntries: FlightEntry[] = extracted.map(f => ({
      _key: `scan-${Date.now()}-${Math.random()}`,
      _isNew: true,
      _deleted: false,
      id: '',
      flightNo: f.flightNo ?? '',
      date: (f.date ?? '').slice(0, 10),
      fromApt: f.fromApt ?? '',
      depTime: f.depTime ?? '',
      toApt: f.toApt ?? '',
      arrTime: f.arrTime ?? '',
      airline: f.airline ?? '',
      notes: f.notes ?? '',
    }))
    const existing: FlightEntry[] = (booking.flights ?? []).map((f: Record<string, unknown>, i: number) => ({
      _key: String(f.id ?? i),
      _isNew: false,
      _deleted: false,
      id: String(f.id ?? ''),
      flightNo: String(f.flightNo ?? ''),
      date: f.date ? String(f.date).slice(0, 10) : '',
      fromApt: String(f.fromApt ?? ''),
      depTime: String(f.depTime ?? ''),
      toApt: String(f.toApt ?? ''),
      arrTime: String(f.arrTime ?? ''),
      airline: String(f.airline ?? ''),
      notes: String(f.notes ?? ''),
    }))
    setFlightEditList([...existing, ...newEntries])
    setFlightChangeReason('')
    setEditFlightModal(true)
    toast.success(`${extracted.length} flight segment${extracted.length > 1 ? 's' : ''} extracted — review and save`)
  }

  /** Same idea for passengers: extracted travellers become new rows to review. */
  function applyExtractedPassengers(extracted: ExtractedPassenger[]) {
    if (extracted.length === 0) { toast.info('No passengers found'); return }
    const existing: PassengerEditRow[] = (booking.passengers ?? []).map((p: Record<string, unknown>, i: number) => ({
      _key: String(p.id ?? i),
      _isNew: false,
      _deleted: false,
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      type: String(p.type ?? 'ADULT'),
      age: p.age != null ? String(p.age) : '',
      passport: String(p.passport ?? ''),
      nationality: String(p.nationality ?? ''),
      contact: String(p.contact ?? ''),
      isLead: !!p.isLead,
    }))
    // Skip anyone already on the booking (same name) so re-scanning is safe.
    const knownNames = new Set(existing.map(p => p.name.trim().toLowerCase()).filter(Boolean))
    const additions: PassengerEditRow[] = extracted
      .filter(p => (p.name ?? '').trim() && !knownNames.has(String(p.name).trim().toLowerCase()))
      .map(p => ({
        _key: `ai-${Date.now()}-${Math.random()}`,
        _isNew: true,
        _deleted: false,
        id: '',
        name: String(p.name ?? '').trim(),
        type: ['ADULT', 'CHILD', 'INFANT'].includes(String(p.type ?? '').toUpperCase()) ? String(p.type).toUpperCase() : 'ADULT',
        age: p.age != null && p.age !== '' ? String(p.age) : '',
        passport: String(p.passport ?? ''),
        nationality: String(p.nationality ?? ''),
        contact: String(p.contact ?? ''),
        isLead: false,
      }))

    if (additions.length === 0) {
      toast.info('Every extracted passenger is already on this booking')
      return
    }
    const rows = [...existing, ...additions]
    if (!rows.some(r => r.isLead)) rows[0] = { ...rows[0], isLead: true }
    setPassengerEditList(rows)
    setEditPassengerModal(true)
    toast.success(`${additions.length} passenger${additions.length > 1 ? 's' : ''} extracted — review and save`)
  }

  /** And for hotels: extracted stays become new-hotel rows in the accom form. */
  function applyExtractedAccommodations(extracted: ExtractedAccommodation[]) {
    if (extracted.length === 0) { toast.info('No hotels found'); return }
    const edits: Record<string, unknown> = {}
    accommodations.forEach((a) => {
      edits[a.id as string] = { hotel: a.hotel, roomType: a.roomType ?? '', address: a.address ?? '', contact: a.contact ?? '' }
    })
    setAccomEdits(edits)
    setDeletedAccomIds([])
    setNewAccoms(extracted.map(a => ({
      city: String(a.city ?? ''),
      hotel: String(a.hotel ?? ''),
      checkIn: String(a.checkIn ?? '').slice(0, 10),
      checkOut: String(a.checkOut ?? '').slice(0, 10),
      roomType: String(a.roomType ?? ''),
      mealType: String(a.mealType ?? ''),
      contact: String(a.contact ?? ''),
      address: String(a.address ?? ''),
    })))
    setEditAccomModal(true)
    toast.success(`${extracted.length} hotel${extracted.length > 1 ? 's' : ''} extracted — review and save`)
  }

  async function handleFlightDriveFileSelected(file: CloudFile) {
    setFlightDrivePickerOpen(false)
    setFlightScanLoading(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/flights/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: file.id, itemName: file.name }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Extraction failed')
      applyExtractedFlights(json.data.flights ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Flight extraction failed')
    } finally {
      setFlightScanLoading(false)
    }
  }

  function openEditBooking() {
    setBookingForm({
      agent: String(booking.agent ?? ''),
      fileHandler: String(booking.fileHandler ?? ''),
      agentBookingId: String(booking.agentBookingId ?? ''),
      arrivalDate: booking.arrivalDate ? String(booking.arrivalDate).slice(0, 10) : '',
      departureDate: booking.departureDate ? String(booking.departureDate).slice(0, 10) : '',
      paxAdults: String(booking.paxAdults ?? 2),
      paxChildren: String(booking.paxChildren ?? 0),
      paxInfants: String(booking.paxInfants ?? 0),
      quotedTotal: String(booking.quotedTotal ?? ''),
      currency: String(booking.currency ?? 'USD'),
      terms: String(booking.terms ?? ''),
      exclusions: String(booking.exclusions ?? ''),
      policyNotes: String(booking.policyNotes ?? ''),
      amendmentNote: String(booking.amendmentNote ?? ''),
      valueAddedServices: String(booking.valueAddedServices ?? ''),
      packageIncludes:    String(booking.packageIncludes    ?? ''),
      packageExcludes:    String(booking.packageExcludes    ?? ''),
      importantNotes:     String(booking.importantNotes     ?? ''),
      tips:               String(booking.tips               ?? ''),
      otherNote:          String(booking.otherNote          ?? ''),
      clientRequest:      String(booking.clientRequest      ?? ''),
    })
    setEditBookingModal(true)
  }

  async function saveBookingEdits() {
    setSavingBooking(true)
    try {
      const res = await fetch(`/api/bookings/${ref}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...bookingForm,
          paxAdults: Number(bookingForm.paxAdults),
          paxChildren: Number(bookingForm.paxChildren),
          paxInfants: Number(bookingForm.paxInfants),
          quotedTotal: Number(bookingForm.quotedTotal),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Booking updated')
      setEditBookingModal(false)
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSavingBooking(false) }
  }

  async function saveAccomEdits() {
    setSavingAccom(true)
    try {
      const accommodationUpdates = Object.entries(accomEdits)
        .filter(([id]) => !deletedAccomIds.includes(id))
        .map(([id, fields]) => ({ id, ...fields }))
      const accommodationAdds = newAccoms
        .filter(a => a.hotel.trim() && a.city.trim() && a.checkIn && a.checkOut)
        .map(a => {
          const nights = Math.max(1, Math.round((new Date(a.checkOut).getTime() - new Date(a.checkIn).getTime()) / 86400000))
          return { ...a, nights }
        })
      const res = await fetch(`/api/bookings/${ref}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accommodationUpdates,
          accommodationDeletes: deletedAccomIds,
          ...(accommodationAdds.length > 0 && { accommodationAdds }),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Accommodation updated')
      setEditAccomModal(false)
      setAccomEdits({})
      setDeletedAccomIds([])
      setNewAccoms([])
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSavingAccom(false) }
  }

  function openEditPassengers() {
    const rows: PassengerEditRow[] = (booking.passengers ?? []).map((p: Record<string, unknown>, i: number) => ({
      _key: String(p.id ?? i),
      _isNew: false,
      _deleted: false,
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      type: String(p.type ?? 'ADULT'),
      age: p.age != null ? String(p.age) : '',
      passport: String(p.passport ?? ''),
      nationality: String(p.nationality ?? ''),
      contact: String(p.contact ?? ''),
      isLead: !!p.isLead,
    }))

    if (rows.length > 0 && !rows.some(r => r.isLead)) {
      rows[0] = { ...rows[0], isLead: true }
    }

    setPassengerEditList(rows)
    setEditPassengerModal(true)
  }

  function updatePassengerRow(key: string, field: keyof Omit<PassengerEditRow, '_key' | '_isNew' | '_deleted' | 'id'>, value: string | boolean) {
    setPassengerEditList(prev => {
      const next = prev.map(p => (p._key === key ? ({ ...p, [field]: value } as PassengerEditRow) : p))
      if (field === 'isLead' && value === true) {
        return next.map(p => (p._key === key ? { ...p, isLead: true } : { ...p, isLead: false }))
      }
      return next
    })
  }

  function addPassengerRow() {
    setPassengerEditList(prev => [...prev, {
      _key: `new-${Date.now()}`,
      _isNew: true,
      _deleted: false,
      id: '',
      name: '',
      type: 'ADULT',
      age: '',
      passport: '',
      nationality: '',
      contact: '',
      isLead: prev.filter(p => !p._deleted).length === 0,
    }])
  }

  function deletePassengerRow(key: string) {
    setPassengerEditList(prev => prev.map(p => p._key === key ? { ...p, _deleted: true } : p))
  }

  async function savePassengerEdits() {
    setSavingPassengers(true)
    try {
      const active = passengerEditList.filter(p => !p._deleted)
      if (active.length === 0) {
        toast.error('At least one passenger is required')
        return
      }

      const rows = active.map(p => ({ ...p }))
      const leadIndex = rows.findIndex(p => p.isLead)
      if (leadIndex === -1) {
        rows[0].isLead = true
      } else {
        rows.forEach((p, idx) => { p.isLead = idx === leadIndex })
      }

      if (rows.some(p => !p.name.trim())) {
        toast.error('Passenger name is required')
        return
      }

      const parseAge = (value: string) => {
        if (!value.trim()) return null
        const n = Number(value)
        if (Number.isNaN(n)) throw new Error('Passenger age must be a number')
        return n
      }

      const passengerUpdates = rows
        .filter(p => !p._isNew)
        .map(p => ({
          id: p.id,
          name: p.name.trim(),
          type: p.type || 'ADULT',
          age: parseAge(p.age),
          passport: p.passport.trim() || null,
          nationality: p.nationality.trim() || null,
          contact: p.contact.trim() || null,
          isLead: p.isLead,
        }))

      const passengerAdds = rows
        .filter(p => p._isNew)
        .map(p => ({
          name: p.name.trim(),
          type: p.type || 'ADULT',
          age: parseAge(p.age),
          passport: p.passport.trim() || null,
          nationality: p.nationality.trim() || null,
          contact: p.contact.trim() || null,
          isLead: p.isLead,
        }))

      if (passengerUpdates.length === 0 && passengerAdds.length === 0 && !passengerEditList.some(p => p._deleted && !p._isNew)) {
        toast.error('No passenger changes to save')
        return
      }

      const passengerDeletes = passengerEditList.filter(p => p._deleted && !p._isNew).map(p => p.id)

      const res = await fetch(`/api/bookings/${ref}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passengerUpdates,
          passengerAdds,
          passengerDeletes,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Passengers updated')
      setEditPassengerModal(false)
      setPassengerEditList([])
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingPassengers(false)
    }
  }

  function getOperationTeamName(): string {
    const c = booking.operationCountry
    if (c === 'VIETNAM')            return 'Vietnam Ground Operation Team'
    if (c === 'SRILANKA')           return 'Sri Lanka Ground Operation Team'
    if (c === 'SINGAPORE')          return 'Singapore Ground Operation Team'
    if (c === 'MALAYSIA')           return 'Malaysia Ground Operation Team'
    if (c === 'SINGAPORE_MALAYSIA') return 'Singapore & Malaysia Ground Operation Team'
    return 'Ground Operation Team'
  }

  function buildConfirmationMessage(firstName: string): string {
    const team = getOperationTeamName()
    return `Hello ${firstName},
Greetings from ${team}! 🌟

Please find the attached *Tour Confirmation* for your upcoming trip.

*Booking Reference:* ${ref}
*Travel Dates:* ${booking.arrivalDate ? new Date(booking.arrivalDate as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} – ${booking.departureDate ? new Date(booking.departureDate as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
*Passengers:* ${booking.paxAdults ?? 0} Adults${(booking.paxChildren as number) > 0 ? `, ${booking.paxChildren} Children` : ''}${(booking.paxInfants as number) > 0 ? `, ${booking.paxInfants} Infants` : ''}

Kindly review the attached PDF and confirm:
✅ All passenger names & contact number are correct
✅ Flight details (if any) are accurate

We kindly request the following information:
1️⃣ Meal preference — Vegetarian or Non-Vegetarian?
2️⃣ Any special assistance required for seniors or infants?

${buildEmergencyContactsBlock(booking.operationCountry as string | null)}

Please reply with your confirmation at the earliest.
Thank you! 🙏
*${team}*`
  }

  function buildFullDetailsMessage(firstName: string): string {
    const team = getOperationTeamName()
    return `Hello ${firstName},
Greetings from ${team}! 🌟

Please find the *Full Tour Details & Vouchers* for your upcoming trip to Vietnam.

*Booking Reference:* ${ref}
*Travel Dates:* ${booking.arrivalDate ? new Date(booking.arrivalDate as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} – ${booking.departureDate ? new Date(booking.departureDate as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}

This document includes:
✅ Complete day-by-day itinerary & tour agenda
✅ Driver & vehicle assignments
✅ All tickets and voucher receipts

Please keep this document handy throughout your travel.

${buildEmergencyContactsBlock(booking.operationCountry as string | null)}

Wishing you a wonderful trip! ✈️
*${team}*`
  }

  function getAutoSendInfo(daysUntilTrip: number, daysBefore: number): { label: string; urgent: boolean } {
    const d = daysUntilTrip - daysBefore
    if (daysUntilTrip <= 0) return { label: 'trip started', urgent: true }
    if (d > 1) return { label: `in ${d}d`, urgent: d <= 2 }
    if (d === 1) return { label: 'tomorrow', urgent: true }
    if (d === 0) return { label: 'today', urgent: true }
    return { label: `${Math.abs(d)}d overdue`, urgent: true }
  }

  function openEditContact() {
    setContactForm({
      agentEmail:     String(booking.agentEmail     ?? ''),
      agentPhone:     String(booking.agentPhone     ?? ''),
      agentWhatsapp:  String(booking.agentWhatsapp  ?? ''),
      agentAddress:   String(booking.agentAddress   ?? ''),
      contactEmail:   String(booking.contactEmail   ?? ''),
      contactPhone:   String(booking.contactPhone   ?? ''),
      contactWhatsapp: String(booking.contactWhatsapp ?? ''),
      contactAddress: String(booking.contactAddress ?? ''),
    })
    setEditContactModal(true)
  }

  async function saveContactEdits() {
    setSavingContact(true)
    try {
      // WhatsApp must never have a + prefix; fall back to phone if empty
      const stripPlus = (v: string) => v.replace(/\+/g, '').trim()
      const payload = {
        ...contactForm,
        agentWhatsapp:   stripPlus(contactForm.agentWhatsapp   || contactForm.agentPhone),
        contactWhatsapp: stripPlus(contactForm.contactWhatsapp || contactForm.contactPhone),
      }
      const res = await fetch(`/api/bookings/${ref}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Contact info updated')
      setEditContactModal(false)
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSavingContact(false) }
  }

  async function saveMealPreferences() {
    setSavingMealPrefs(true)
    try {
      const updates = Object.entries(mealPrefs).map(([id, mealPreference]) => ({
        id,
        mealPreference: mealPreference || null,
      }))
      const res = await fetch(`/api/bookings/${ref}/passengers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Meal preferences saved')
      setMealPrefsDirty(false)
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSavingMealPrefs(false) }
  }

  async function openWhatsApp() {
    const { mode, settings } = await loadTestMode()
    const lead = (booking.passengers ?? []).find((p: { isLead: boolean; name: string }) => p.isLead) ?? (booking.passengers ?? [])[0]
    const firstName = (lead?.name ?? 'Guest').split(' ')[0]
    // WhatsApp goes to CUSTOMER only — never default to agent numbers
    const storedPhone = booking.contactWhatsapp ?? booking.contactPhone ?? ''
    setWaPhone(mode ? settings.testWhatsapp : storedPhone)
    setWaPdfType('confirmation')
    setWaMessage(buildConfirmationMessage(firstName))
    setWaAttachPdf(true)
    void loadWaQueue()
    setWaModal(true)
  }

  async function handleQCAutoSend() {
    setQcAutoSending(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/qc-send`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Type-1 messages sent (Email + WhatsApp)')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setQcAutoSending(false)
    }
  }

  /** Opens the feedback modal pre-filled with whatever was already recorded. */
  function openFeedbackModal() {
    const existing = booking?.customerFeedback ?? null
    setFeedbackRating(existing?.rating ?? 0)
    setFeedbackComment(existing?.comment ?? '')
    setFeedbackModal(true)
  }

  async function saveFeedbackAndComplete() {
    setFeedbackSaving(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: feedbackRating || null, comment: feedbackComment }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Trip completed and feedback saved')
      setFeedbackModal(false)
      setFeedbackRating(0)
      setFeedbackComment('')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setFeedbackSaving(false) }
  }

  async function openEmailModal() {
    const { mode, settings } = await loadTestMode()
    const agentEmail   = (booking.agentEmail   as string | null) ?? ''
    const contactEmail = (booking.contactEmail as string | null) ?? ''
    if (mode) {
      setEmailTo(settings.testEmail1)
      setEmailCc([settings.testEmail2])
    } else {
      setEmailTo(agentEmail)
      const ccList = contactEmail && contactEmail !== agentEmail ? [contactEmail] : []
      setEmailCc(ccList)
    }
    setEmailModal(true)
  }

  async function sendEmail() {
    setEmailSending(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/send-agent-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cc: emailCc.filter(Boolean) }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Confirmation email sent')
      setEmailModal(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setEmailSending(false)
    }
  }

  function switchWaPdfType(type: 'confirmation' | 'full') {
    const lead = (booking.passengers ?? []).find((p: { isLead: boolean; name: string }) => p.isLead) ?? (booking.passengers ?? [])[0]
    const firstName = (lead?.name ?? 'Guest').split(' ')[0]
    setWaPdfType(type)
    setWaMessage(type === 'full' ? buildFullDetailsMessage(firstName) : buildConfirmationMessage(firstName))
  }

  async function sendWhatsApp() {
    if (!waPhone.trim()) { toast.error('Enter the client phone number'); return }
    setWaSending(true)
    try {
      const lead = (booking.passengers ?? []).find((p: { isLead: boolean; name: string }) => p.isLead) ?? (booking.passengers ?? [])[0]
      const res = await fetch(`/api/bookings/${ref}/whatsapp`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:        waPhone.replace(/\D/g, ''),
          name:      lead?.name ?? 'Guest',
          message:   waMessage,
          attachPdf: waAttachPdf,
          pdfType:   waPdfType,
        }),
      })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error)
      const queued = json.data?.queued === true
      toast.success(json.message || (queued ? 'Queued — will send when the customer replies.' : 'Sent!'))
      await loadWaQueue()
      // On a queued send keep the modal open so the queue indicator is visible;
      // on an immediate delivery, close it.
      if (!queued) setWaModal(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally { setWaSending(false) }
  }

  // Cold-customer opener: WhatsApp won't deliver the free-form confirmation + PDF
  // unless the customer has messaged us in the last 24h. This sends the approved
  // "please reply to us" template (delivers outside the window); once the customer
  // replies, the 24h window opens and the Tour Confirmation can be sent normally.
  async function sendWhatsAppOpener() {
    if (!waPhone.trim()) { toast.error('Enter the client phone number'); return }
    setWaOpenerSending(true)
    try {
      const lead = (booking.passengers ?? []).find((p: { isLead: boolean; name: string }) => p.isLead) ?? (booking.passengers ?? [])[0]
      const res = await fetch(`/api/bookings/${ref}/whatsapp-opener`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:   waPhone.replace(/\D/g, ''),
          name: lead?.name ?? 'Guest',
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Reply request sent. Once the customer replies, send the confirmation.')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally { setWaOpenerSending(false) }
  }

  // Tour Confirmations queued (waiting for the customer to reply) for this booking.
  async function loadWaQueue() {
    try {
      const res = await fetch(`/api/bookings/${ref}/whatsapp-queue`)
      const json = await res.json()
      if (json.success) setWaQueue(json.data?.queued ?? [])
    } catch { /* non-fatal — indicator just won't show */ }
  }

  // Cancel a queued confirmation so it won't send when the customer replies.
  async function cancelWaQueued(id: string) {
    try {
      const res = await fetch(`/api/bookings/${ref}/whatsapp-queue?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Queued message cancelled')
      await loadWaQueue()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel')
    }
  }

  return (
    <div>
      <Header
        title={`Booking ${ref}`}
        subtitle={(booking.agent as string) ?? ''}
        actions={
          <button onClick={() => router.back()} className="btn-ghost btn text-sm">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        }
      />

      {/* Cancelled bookings stay fully readable, but the whole page is visually
          shaded and red-marked so nobody mistakes them for live work. */}
      <div className={cn(
        'p-8 space-y-6',
        isCancelled && 'bg-slate-100/70 [&>*:not(:first-child)]:opacity-75 [&>*:not(:first-child)]:grayscale-[45%]',
      )}>

        {isCancelled && (
          <div className="relative overflow-hidden rounded-xl border-2 border-red-300 bg-gradient-to-r from-red-50 via-rose-50 to-red-50 p-5 shadow-sm">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{ backgroundImage: 'repeating-linear-gradient(45deg,#dc2626 0 12px,transparent 12px 24px)' }}
            />
            <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow">
                <XCircle className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold uppercase tracking-[0.18em] text-red-700">
                  Booking Cancelled
                </p>
                <p className="mt-1 text-sm text-red-800/90">
                  {(booking as any).cancellationReason || 'No reason recorded.'}
                </p>
                <p className="mt-1.5 text-xs text-red-600/80">
                  Cancelled by <strong>{(booking as any).cancelledByName ?? 'Unknown'}</strong>
                  {(booking as any).cancelledByEmail ? ` (${(booking as any).cancelledByEmail})` : ''}
                  {(booking as any).cancelledAt ? ` on ${formatDateTime((booking as any).cancelledAt)}` : ''}
                  {' '}· This booking is view-only and hidden from active operations lists.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Cancellation requested — held until the accounts team signs off. */}
        {isPendingCancel && (
          <div className="relative overflow-hidden rounded-xl border-2 border-orange-300 bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 p-5 shadow-sm">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{ backgroundImage: 'repeating-linear-gradient(45deg,#ea580c 0 12px,transparent 12px 24px)' }}
            />
            <div className="relative flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white shadow">
                <XCircle className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold uppercase tracking-[0.18em] text-orange-700">
                  Pending Approval — Accounts Team (Cancelling)
                </p>
                <p className="mt-1 text-sm text-orange-900/90">
                  {(booking as any).cancellationReason || 'No reason recorded.'}
                </p>
                <p className="mt-1.5 text-xs text-orange-700/80">
                  Requested by <strong>{(booking as any).cancelledByName ?? 'Unknown'}</strong>
                  {(booking as any).cancelledByEmail ? ` (${(booking as any).cancelledByEmail})` : ''}
                  {(booking as any).cancelRequestedAt ? ` on ${formatDateTime((booking as any).cancelRequestedAt)}` : ''}
                  {' '}· The booking is <strong>not cancelled yet</strong>. It stays at{' '}
                  {STATUS_LABELS[((booking as any).cancelPrevStatus ?? 'BT_CONFIRMED') as BookingStatus]}{' '}
                  until the accounts team approves or rejects.
                </p>

                <div className="mt-4 rounded-lg border border-orange-200 bg-white/80 px-4 py-3">
                  <p className="text-xs leading-relaxed text-slate-600">
                    The decision is made by the accounts team in the <strong>Apple Accounts</strong>
                    {' '}system (Cancellation Management). Once they approve, this booking moves to
                    {' '}<strong>Confirmed Cancellation</strong> and the cancellation notice is emailed
                    {' '}automatically. If they reject it, the booking returns to its previous status.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lifecycle + status */}
        <Card className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="text-2xl font-bold font-mono text-slate-900">{booking.bookingRef as string}</span>
                {/* Version selector — shows the active version; admins can switch */}
                {(() => {
                  const versions = ((booking as any).versions ?? []) as { versionNo: number; source?: string | null; createdAt?: string; amendmentNote?: string | null }[]
                  const active = Number((booking as any).version ?? 1)
                  const isSA = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
                  const canSwitch = isSA && versions.length > 1
                  return (
                    <div className="relative">
                      <button
                        type="button"
                        disabled={!canSwitch}
                        onClick={() => canSwitch && setVersionMenuOpen(o => !o)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${canSwitch ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 cursor-pointer' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
                        title={canSwitch ? 'Switch active version' : `Version ${active}`}
                      >
                        <History className="w-3 h-3" /> V{active}
                        {canSwitch && <ChevronDown className="w-3 h-3" />}
                      </button>
                      {versionMenuOpen && canSwitch && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setVersionMenuOpen(false)} />
                          <div className="absolute left-0 mt-1 z-20 w-64 bg-white rounded-lg shadow-lg border border-slate-200 py-1 max-h-72 overflow-auto">
                            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Versions</div>
                            {versions.map(v => (
                              <button
                                key={v.versionNo}
                                type="button"
                                disabled={v.versionNo === active}
                                onClick={() => { setRestoreTarget(v.versionNo); setVersionMenuOpen(false) }}
                                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${v.versionNo === active ? 'bg-indigo-50 cursor-default' : 'hover:bg-slate-50 cursor-pointer'}`}
                              >
                                <span className="flex flex-col">
                                  <span className="font-semibold text-slate-800">V{v.versionNo}{v.versionNo === active && <span className="ml-1.5 text-[10px] text-indigo-600 font-bold">ACTIVE</span>}</span>
                                  <span className="text-[11px] text-slate-400">
                                    {v.createdAt ? formatDate(v.createdAt) : ''}{v.source ? ` · ${v.source}` : ''}
                                  </span>
                                </span>
                                {v.versionNo !== active && <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })()}
                {(booking as any).cntlNumber && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                      <Ticket className="w-3 h-3" /> CNTL: {(booking as any).cntlNumber}
                    </span>
                  )}
                {booking.isNumber && (
                  <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                    <Ticket className="w-3 h-3" /> IS: {booking.isNumber as string}
                  </span>
                )}
                {booking.agentBookingId && (
                  <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                    <UserCheck className="w-3 h-3" /> Agent: {booking.agentBookingId as string}
                  </span>
                )}
                <StatusBadge status={status} />
                {booking.operationCountry && (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                    booking.operationCountry === 'VIETNAM'            ? 'bg-red-50 text-red-600 border-red-200' :
                    booking.operationCountry === 'SRILANKA'           ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                    booking.operationCountry === 'SINGAPORE'          ? 'bg-blue-50 text-blue-600 border-blue-200' :
                    booking.operationCountry === 'MALAYSIA'           ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                    booking.operationCountry === 'SINGAPORE_MALAYSIA' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                    'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    <span className="inline-flex items-center gap-1">
                      <CountryFlag country={booking.operationCountry} className="w-4 h-3" />
                      {countryLabel(booking.operationCountry as import('@/lib/country-detection').OperationCountry)}
                    </span>
                  </span>
                )}
                {Boolean(booking.amendmentNote) && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                    {String(booking.amendmentNote)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {formatDate(booking.arrivalDate as string)} → {formatDate(booking.departureDate as string)}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {booking.paxAdults as number} adults, {booking.paxChildren as number} children{(booking.paxInfants as number) > 0 ? `, ${booking.paxInfants as number} infants` : ''}
                </span>
                <span className="flex items-center gap-1">
                  <CreditCard className="w-4 h-4" />
                  {formatCurrency(booking.quotedTotal as string, booking.currency as string)}
                </span>
                {daysUntil > 0 && (
                  <span className={`flex items-center gap-1 font-medium ${daysUntil <= 7 ? 'text-red-600' : daysUntil <= 21 ? 'text-orange-600' : 'text-slate-500'}`}>
                    <Clock className="w-4 h-4" />
                    T−{daysUntil} days
                  </span>
                )}
              </div>
              {daysUntil <= 21 && daysUntil > 0 && (
                <p className="mt-2 text-xs text-red-600 font-medium">
                  ⚠ Cancellation penalty window active (100% charge applies)
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              {transitions.map(t => {
                // New step-through statuses use the advance-status endpoint
                // QC1_PASS and QC2_PASS are auto-triggered — never show as manual buttons
                const ADVANCE_STEPS: BookingStatus[] = [
                  'TE_REVIEWED', 'DRIVER_ALLOCATED',
                  'TICKETS_ISSUED', 'MSG_SENT_CUSTOMER', 'FEEDBACK_DONE',
                ]

                const isAdvanceStep = ADVANCE_STEPS.includes(t.to)
                const isComplete = t.to === 'COMPLETED'

                const key = t.to === 'CHANGE_REQUESTED' ? 'change-request'
                  : t.from === 'CHANGE_REQUESTED' && t.to === 'BT_CONFIRMED' ? 'resubmit'
                  : t.to === 'GT_REVIEW' ? 'submit-ground'
                  : t.to === 'BT_CONFIRMED' ? 'confirm'
                  : t.to === 'GT_VERIFIED' ? 'verify'
                  : t.to === 'OPERATIONS_READY' ? 'mark-operations-ready'
                  : t.to === 'CLIENT_LIVE' ? 'client-live'
                  : t.to === 'IN_PROGRESS' ? 'in-progress'
                  : isAdvanceStep ? `advance-step-${t.to}`
                  : isComplete ? 'complete-feedback'
                  : ''

                if (!key) return null

                const needsNote = ['change-request', 'resubmit'].includes(key)
                const isTeConfirm = key === 'verify'

                return (
                  <Button
                    key={t.to}
                    variant={t.to === 'CHANGE_REQUESTED' ? 'danger' : 'primary'}
                    size="sm"
                    loading={actionLoading === key}
                    className={isTeConfirm ? '!bg-emerald-600 !border-emerald-700 hover:!bg-emerald-700 font-bold tracking-wide' : undefined}
                    onClick={() => {
                      if (needsNote || isTeConfirm) {
                        setPendingAction(key); setNote(''); setChangeModal(true)
                      } else if (isAdvanceStep && t.to === 'FEEDBACK_DONE') {
                        // Feedback Done → open feedback modal so user can write + complete
                        openFeedbackModal()
                      } else if (isAdvanceStep) {
                        doTransition('advance-status', { to: t.to })
                      } else if (isComplete) {
                        openFeedbackModal()
                      } else {
                        doTransition(key)
                      }
                    }}
                  >
                    {isTeConfirm ? '✓ Client Confirm' : t.label}
                  </Button>
                )
              })}

              {/* Get Feedback — always visible after trip is in operational post-phase */}
              {(['MSG_SENT_CUSTOMER', 'FEEDBACK_DONE', 'QC2_PASS', 'COMPLETED'] as string[]).includes(status) && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="!bg-yellow-50 !border-yellow-300 !text-yellow-800 hover:!bg-yellow-100"
                  onClick={openFeedbackModal}
                >
                  ⭐ Get Feedback
                </Button>
              )}

              {/* Cancel */}
              {!['COMPLETED', 'CANCELLED', 'PENDING_CANCELLATION'].includes(status) && CAN_CANCEL_ROLES.includes(role) && (
                <Button variant="danger" size="sm"
                  onClick={() => { setCancelReason(DEFAULT_CANCEL_REASON); setCancelModal(true) }}>
                  <XCircle className="w-4 h-4 mr-1" /> Cancel Booking
                </Button>
              )}

              {/* OneDrive folder link + assignment */}
              {booking.onedriveFolderUrl ? (
                <div className="flex items-center gap-1">
                  <a
                    href={String(booking.onedriveFolderUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.5 10.6A4.5 4.5 0 0 0 16.5 7a4.5 4.5 0 0 0-4.35 3.4A3 3 0 0 0 9 13a3 3 0 0 0 3 3h8.5a2.5 2.5 0 0 0 0-5h-.5a4.5 4.5 0 0 0-.5-0.4z"/>
                    </svg>
                    Drive
                  </a>
                  {['BT_USER', 'GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                    <button
                      onClick={() => setFolderEditOpen(true)}
                      className="btn btn-sm btn-secondary px-1.5"
                      title="Change folder"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ) : (
                ['BT_USER', 'GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                  <button
                    onClick={() => setFolderEditOpen(true)}
                    className="btn btn-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.5 10.6A4.5 4.5 0 0 0 16.5 7a4.5 4.5 0 0 0-4.35 3.4A3 3 0 0 0 9 13a3 3 0 0 0 3 3h8.5a2.5 2.5 0 0 0 0-5h-.5a4.5 4.5 0 0 0-.5-0.4z"/>
                    </svg>
                    Assign Drive Folder
                  </button>
                )
              )}

              {/* Links to sub-pages */}
              <Link href={`/dashboard/bookings/${ref}/agenda`} className="btn btn-secondary btn-sm">
                <MapPin className="w-3.5 h-3.5" /> Agenda
              </Link>
              <Link href={`/dashboard/bookings/${ref}/tickets`} className="btn btn-secondary btn-sm">
                <Ticket className="w-3.5 h-3.5" /> Tickets
              </Link>
              {/* Drivers — GT can assign drivers from the Agenda page */}
              {['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <Link
                  href={`/dashboard/bookings/${ref}/agenda`}
                  className={`btn btn-sm ${
                    ['OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS'].includes(status)
                      ? 'bg-blue-600 text-white hover:bg-blue-700 border border-blue-700'
                      : 'btn-secondary'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" /> Drivers
                </Link>
              )}
              {['BT_USER', 'AC_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <Link href={`/dashboard/bookings/${ref}/pnl`} className="btn btn-secondary btn-sm">
                  <TrendingUp className="w-3.5 h-3.5" /> P&amp;L
                </Link>
              )}
              {canEditBooking && (
                <button onClick={openEditBooking} className="btn btn-secondary btn-sm">
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
              )}
              {['BT_USER', 'GT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <Link href={`/print/booking/${ref}`} target="_blank" className="btn btn-secondary btn-sm">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </Link>
              )}
              {['BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/bookings/${ref}/portal-link`)
                      const json = await res.json()
                      if (!json.success) throw new Error(json.error)
                      const url = `${window.location.origin}${json.data.path}`
                      await navigator.clipboard.writeText(url)
                      toast.success('Customer portal link copied! 🔗 Share it with the traveller — no login needed.')
                    } catch {
                      toast.error('Could not generate portal link')
                    }
                  }}
                  className="btn btn-sm bg-brand-600 text-white border border-brand-700 hover:bg-brand-700 flex items-center gap-1.5"
                  title="Copy a no-login link the customer can open to view their whole trip"
                >
                  <Copy className="w-3.5 h-3.5" /> Portal Link
                </button>
              )}
              {['TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <button
                  onClick={openWhatsApp}
                  className="btn btn-sm bg-green-600 text-white border border-green-700 hover:bg-green-700 flex items-center gap-1.5"
                  title={waQueue.length > 0 ? `${waQueue.length} message(s) queued — waiting for the customer to reply` : undefined}
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                  {waQueue.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 leading-none">
                      <Clock className="w-3 h-3" /> {waQueue.length}
                    </span>
                  )}
                </button>
              )}
              {['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <button
                  onClick={async () => { await loadTestMode(); setAiCallsModal(true) }}
                  className="btn btn-sm bg-violet-600 text-white border border-violet-700 hover:bg-violet-700 flex items-center gap-1.5"
                >
                  <Phone className="w-3.5 h-3.5" /> AI Calls &amp; Feedback
                </button>
              )}
              {['TE_USER', 'GT_TE_USER','SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <button
                  onClick={openEmailModal}
                  className="btn btn-sm bg-blue-600 text-white border border-blue-700 hover:bg-blue-700 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Send Email
                </button>
              )}
              {['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && !['COMPLETED'].includes(status) && (
                <button
                  onClick={async () => {
                    if (!confirm(`Permanently delete booking ${ref}? This cannot be undone.`)) return
                    const res = await fetch(`/api/bookings/${ref}`, { method: 'DELETE' })
                    const json = await res.json()
                    if (json.success) { toast.success('Booking deleted'); router.push('/dashboard/bookings') }
                    else toast.error(json.error ?? 'Delete failed')
                  }}
                  className="btn btn-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* Operation Checklist */}
          <OperationChecklist
            status={status}
            hasPnl={!!(pnl && (booking.pnl as any)?.lineItems?.length > 0)}
            extPnlLinked={extPnlLinked}
            ticketCount={(booking.tickets as any[])?.length ?? 0}
            agendaItems={(booking.tourAgenda as any)?.items ?? []}
          />
        </Card>

        {/* TC Confirmation Details — always shown */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-brand-400" />
            <h3 className="text-sm font-semibold text-slate-900">Tour Confirmation Details</h3>
            {['BT_USER', 'GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && !tcEditOpen && (
              <button
                onClick={() => {
                  setTcEditForm({
                    isNumber:       String(booking?.isNumber ?? ''),
                    agentBookingId: String(booking?.agentBookingId ?? ''),
                    cntlNumber:     String(booking?.cntlNumber ?? ''),
                    bookingRef:     ref,
                  })
                  setTcEditOpen(true)
                }}
                className="ml-1 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                title="Edit identifiers"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Inline country selector — always editable */}
            <div className="ml-auto flex items-center gap-1.5">
              <select
                value={(booking.operationCountry as string) ?? ''}
                onChange={async (e) => {
                  const val = e.target.value || null
                  try {
                    const res = await fetch(`/api/bookings/${ref}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ operationCountry: val }),
                    })
                    const json = await res.json()
                    if (!json.success) throw new Error(json.error)
                    toast.success('Country updated')
                    await load()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Update failed')
                  }
                }}
                className={`text-xs font-semibold rounded-full px-3 py-1 border cursor-pointer appearance-none pr-6 ${
                  booking.operationCountry === 'VIETNAM'            ? 'bg-red-500/10 text-red-500 border-red-500/25' :
                  booking.operationCountry === 'SRILANKA'           ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/25' :
                  booking.operationCountry === 'SINGAPORE'          ? 'bg-blue-500/10 text-blue-500 border-blue-500/25' :
                  booking.operationCountry === 'MALAYSIA'           ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25' :
                  booking.operationCountry === 'SINGAPORE_MALAYSIA' ? 'bg-blue-500/10 text-blue-500 border-blue-500/25' :
                  'bg-slate-100 text-slate-400 border-slate-200'
                }`}
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%239ca3af\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
              >
                <option value="">Country not set</option>
                <option value="VIETNAM">Vietnam</option>
                <option value="SRILANKA">Sri Lanka</option>
                <option value="SINGAPORE">Singapore</option>
                <option value="MALAYSIA">Malaysia</option>
                <option value="SINGAPORE_MALAYSIA">Singapore &amp; Malaysia (legacy)</option>
              </select>
            </div>
          </div>
          {/* TC identifier edit form */}
          {tcEditOpen && (
            <div className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <p className="text-xs font-semibold text-slate-700 mb-1">Edit Booking Identifiers</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">IS Number</label>
                  <input
                    className="form-input w-full text-sm font-mono"
                    placeholder="e.g. VN19428, IS48375 , MY23139, SG22228"
                    value={tcEditForm.isNumber}
                    onChange={e => setTcEditForm(f => ({ ...f, isNumber: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">CNTL No.</label>
                  <input
                    className="form-input w-full text-sm font-mono"
                    placeholder="e.g. 463720CNTL, CNTL459773"
                    value={tcEditForm.cntlNumber}
                    onChange={e => setTcEditForm(f => ({ ...f, cntlNumber: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Agent Ref. No.</label>
                  <input
                    className="form-input w-full text-sm font-mono"
                    placeholder="Agent booking reference"
                    value={tcEditForm.agentBookingId}
                    onChange={e => setTcEditForm(f => ({ ...f, agentBookingId: e.target.value }))}
                  />
                </div>
                {['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Tour Ref (internal)</label>
                    <input
                      className="form-input w-full text-sm font-mono"
                      value={tcEditForm.bookingRef}
                      onChange={e => setTcEditForm(f => ({ ...f, bookingRef: e.target.value }))}
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={saveTcIdentifiers}
                  disabled={tcEditSaving}
                  className="btn btn-sm btn-primary"
                >
                  {tcEditSaving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setTcEditOpen(false)} className="btn btn-sm btn-secondary">Cancel</button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Tour Ref</p>
              <p className="text-sm font-mono font-semibold text-slate-900">{booking.bookingRef as string}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">IS Number</p>
              {booking.isNumber
                ? <p className="text-sm font-mono font-semibold text-brand-600">{booking.isNumber as string}</p>
                : <p className="text-sm text-slate-300 italic text-xs">Not set — click <Edit2 className="inline w-3 h-3" /> to add</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">CNTL No.</p>
              {(booking as any).cntlNumber
                ? <p className="text-sm font-mono font-semibold text-violet-600">{(booking as any).cntlNumber}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Agent Ref. No.</p>
              {booking.agentBookingId
                ? <p className="text-sm font-mono text-slate-700">{booking.agentBookingId as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5 flex items-center gap-1">
                <UserCheck className="w-3 h-3 text-slate-400" /> Agent / Tour Operator
              </p>
              {booking.agent
                ? <p className="text-sm font-semibold text-slate-800">{booking.agent as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Destination</p>
              {booking.tourDestination
                ? <p className="text-sm text-slate-700">{booking.tourDestination as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            {booking.dealName && (
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Deal Name</p>
                <p className="text-sm font-medium text-slate-800">{booking.dealName as string}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Travel Date</p>
              <p className="text-sm text-slate-700">
                {formatDate(booking.arrivalDate as string)} → {formatDate(booking.departureDate as string)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">File Handler</p>
              {booking.fileHandler
                ? <p className="text-sm text-slate-700">{booking.fileHandler as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Checked By</p>
              {booking.checkedBy
                ? <p className="text-sm text-slate-700">{booking.checkedBy as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Reconfirm By</p>
              {booking.reconfirmBy
                ? <p className="text-sm text-slate-700">{booking.reconfirmBy as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Guests&apos; Language Preference</p>
              {booking.languagePreference
                ? <p className="text-sm text-slate-700">{booking.languagePreference as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Special Occasions</p>
              {booking.specialOccasions
                ? <p className="text-sm text-slate-700">{booking.specialOccasions as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div className="col-span-2 md:col-span-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Chauffeur / Tour Guide Contact</p>
              {booking.chauffeurContact
                ? <p className="text-sm text-slate-700 whitespace-pre-line">{booking.chauffeurContact as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
          </div>

          {/* Customer Origin — where the traveller came from (flights + AI) */}
          <div className="mt-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-sky-50 to-white overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-200 flex items-center justify-center overflow-hidden">
                {origin?.iso2
                  ? <FlagByCode code={origin.iso2} className="w-7 h-5 rounded-sm shadow-sm" title={origin.country} />
                  : <PlaneLanding className="w-5 h-5 text-indigo-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold flex items-center gap-1">
                  <Globe className="w-3 h-3" /> Customer Came From
                </p>
                {origin ? (
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5">
                    <span className="text-base font-bold text-slate-900">{origin.country}</span>
                    {origin.city && <span className="text-xs text-slate-500">via {origin.city}</span>}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                      origin.confidence === 'high'   ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                      origin.confidence === 'medium' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                                       'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>{origin.confidence} confidence</span>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">Not yet identified — detect from flight routing &amp; booking signals</p>
                )}
                {origin?.reasoning && <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={origin.reasoning}>{origin.reasoning}</p>}
              </div>
              <button
                onClick={() => detectOrigin(false)}
                disabled={originLoading}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 px-3 py-2 rounded-lg transition-colors"
                title="Use AI to identify the customer's country of origin from flight details"
              >
                {originLoading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Detecting…</>
                  : <><Sparkles className="w-3.5 h-3.5" /> {origin ? 'Re-detect' : 'Detect Origin'}</>}
              </button>
            </div>
          </div>
        </Card>

        {/* Customer Feedback — manual rating/comment saved by the TE team */}
        {customerFeedback && (
          <Card>
            <CardHeader
              action={
                (['MSG_SENT_CUSTOMER', 'FEEDBACK_DONE', 'QC2_PASS', 'COMPLETED'] as string[]).includes(status) && (
                  <button
                    onClick={openFeedbackModal}
                    className="text-xs font-semibold text-brand-600 hover:underline"
                  >
                    Edit feedback
                  </button>
                )
              }
            >
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <span className="text-yellow-400">★</span> Customer Feedback
                <span className="text-xs text-slate-400 font-normal">— recorded manually</span>
              </h3>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2">
                {customerFeedback.rating ? (
                  <>
                    <span className="text-lg tracking-wide">
                      {[1, 2, 3, 4, 5].map(star => (
                        <span key={star} className={star <= customerFeedback.rating ? 'text-yellow-400' : 'text-slate-200'}>★</span>
                      ))}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">{customerFeedback.rating} / 5</span>
                  </>
                ) : (
                  <span className="text-sm text-slate-400 italic">No rating given</span>
                )}
              </div>

              {customerFeedback.comment ? (
                <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  {customerFeedback.comment}
                </p>
              ) : (
                <p className="text-sm text-slate-400 italic">No comment recorded</p>
              )}

              <p className="text-[11px] text-slate-400">
                Saved by {customerFeedback.savedBy?.name ?? 'TE team'} · {formatDateTime(customerFeedback.updatedAt as string)}
              </p>
            </CardBody>
          </Card>
        )}

        {/* QC Panel — visible to operations/TE/admin */}
        {['GT_USER', 'TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
          <BookingQCPanel
            booking={booking}
            onAutoSend={handleQCAutoSend}
            autoSending={qcAutoSending}
            daysUntilTrip={daysUntil}
          />
        )}

        {/* AI Voice Calls — Traveller Experience panel */}
        {['TE_USER', 'GT_TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
          <TravellerExperiencePanel
            bookingRef={ref}
            booking={booking}
          />
        )}

        {/* AI Call Transcripts — DB-backed reconfirmation / on-tour / post-tour */}
        {['TE_USER', 'GT_TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
          <BookingCallTranscripts bookingRef={ref} />
        )}

        {/* Customer WhatsApp — manual daily briefings + feedback form */}
        {['TE_USER', 'GT_USER', 'GT_TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
          <CustomerWhatsappPanel bookingRef={ref} />
        )}



        {changeRequests.filter(cr => (cr as Record<string, unknown>).status === 'OPEN').length > 0 && (
          <div className="flex items-start gap-3 px-5 py-4 bg-orange-50 border border-orange-200 rounded-xl">
            <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">Open Change Requests</p>
              {changeRequests.filter(cr => (cr as Record<string, unknown>).status === 'OPEN').map((cr) => (
                <p key={cr.id as string} className="text-xs text-orange-700 mt-1">
                  • {(cr as Record<string, unknown>).notes as string}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Three-column detail grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Passengers + Meal Preferences */}
          <Card>
            <CardHeader
              action={
                canEditBooking ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAiPassengerOpen(true)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors border border-violet-200"
                    >
                      <Wand2 className="w-3 h-3" /> AI Auto-fill
                    </button>
                    <button
                      onClick={openEditPassengers}
                      className="flex items-center gap-1.5 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors border border-brand-200"
                    >
                      <Users className="w-3 h-3" /> Edit Passengers
                    </button>
                    {mealPrefsDirty && (
                      <button
                        onClick={saveMealPreferences}
                        disabled={savingMealPrefs}
                        className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {savingMealPrefs
                          ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                          : <><Save className="w-3 h-3" /> Save Meal Prefs</>}
                      </button>
                    )}
                  </div>
                ) : undefined
              }
            >
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" /> Passengers
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              {(() => {
                const MEAL_OPTIONS = [
                  { label: 'Non-Veg',      value: 'Non-Vegetarian', colour: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100',   active: 'bg-orange-500 text-white border-orange-500' },
                  { label: 'Vegetarian',   value: 'Vegetarian',     colour: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',       active: 'bg-green-600 text-white border-green-600' },
                  { label: 'Vegan',        value: 'Vegan',          colour: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100', active: 'bg-emerald-600 text-white border-emerald-600' },
                  { label: 'Halal',        value: 'Halal',          colour: 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100',           active: 'bg-teal-600 text-white border-teal-600' },
                  { label: 'Jain',         value: 'Jain',           colour: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',       active: 'bg-amber-500 text-white border-amber-500' },
                  { label: 'Gluten-Free',  value: 'Gluten-Free',    colour: 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100',   active: 'bg-yellow-500 text-white border-yellow-500' },
                  { label: 'No Pork',      value: 'No Pork',        colour: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',               active: 'bg-red-500 text-white border-red-500' },
                  { label: 'No Beef',      value: 'No Beef',        colour: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',           active: 'bg-rose-500 text-white border-rose-500' },
                  { label: 'Seafood-Free', value: 'Seafood-Free',   colour: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',           active: 'bg-blue-500 text-white border-blue-500' },
                  { label: 'Diabetic',     value: 'Diabetic',       colour: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',   active: 'bg-purple-500 text-white border-purple-500' },
                ]

                function togglePref(passengerId: string, value: string) {
                  setMealPrefs(prev => {
                    const current = (prev[passengerId] ?? '').split(',').map(s => s.trim()).filter(Boolean)
                    const next = current.includes(value)
                      ? current.filter(v => v !== value)
                      : [...current, value]
                    return { ...prev, [passengerId]: next.join(', ') }
                  })
                  setMealPrefsDirty(true)
                }

                return passengers.map((p) => {
                  const pid = p.id as string
                  const pref = mealPrefs[pid] ?? ''
                  const selected = pref.split(',').map(s => s.trim()).filter(Boolean)
                  const isOpen = expandedMeal.has(pid)

                  function toggleOpen() {
                    setExpandedMeal(prev => {
                      const next = new Set(prev)
                      next.has(pid) ? next.delete(pid) : next.add(pid)
                      return next
                    })
                  }

                  return (
                    <div key={pid} className="border-b border-slate-100 last:border-0">
                      {/* Passenger name row */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0">
                          {(p.name as string).slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {p.name as string}
                            {p.isLead && <span className="ml-2 text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full">Lead</span>}
                          </p>
                          <p className="text-xs text-slate-500">{p.type as string}{p.age ? ` · Age ${p.age}` : ''}</p>
                        </div>
                        {/* Meal toggle — shows selected chips inline when collapsed, chevron to expand */}
                        <button
                          type="button"
                          onClick={toggleOpen}
                          className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-700 transition-colors flex-shrink-0"
                        >
                          {selected.length > 0 && !isOpen && (
                            <div className="flex flex-wrap gap-1 max-w-[120px]">
                              {selected.slice(0, 2).map(v => {
                                const opt = MEAL_OPTIONS.find(o => o.value === v)
                                return (
                                  <span key={v} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${opt ? opt.active : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                    {v}
                                  </span>
                                )
                              })}
                              {selected.length > 2 && <span className="text-[10px] text-slate-400">+{selected.length - 2}</span>}
                            </div>
                          )}
                          {!selected.length && !isOpen && (
                            <span className="text-[11px] text-slate-300 font-medium">🍽 Set meal</span>
                          )}
                          {isOpen
                            ? <ChevronRight className="w-3.5 h-3.5 rotate-90 text-slate-400" />
                            : <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
                        </button>
                      </div>

                      {/* Expandable meal preference chips */}
                      {isOpen && (
                        <div className="px-4 pb-3 ml-11">
                          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">🍽 Meal Preferences</p>
                          {canEditBooking ? (
                            <div className="flex flex-wrap gap-1.5">
                              {MEAL_OPTIONS.map(opt => {
                                const isOn = selected.includes(opt.value)
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => togglePref(pid, opt.value)}
                                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${isOn ? opt.active : opt.colour}`}
                                  >
                                    {isOn && <span className="mr-0.5">✓</span>}{opt.label}
                                  </button>
                                )
                              })}
                            </div>
                          ) : selected.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {selected.map(v => {
                                const opt = MEAL_OPTIONS.find(o => o.value === v)
                                return (
                                  <span key={v} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${opt ? opt.active : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                    {v}
                                  </span>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-300 italic">Not specified</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}
            </CardBody>
          </Card>

          {/* Flights */}
          <Card>
            <CardHeader
              action={canEditFlights ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setAiFlightOpen(true)}
                    disabled={flightScanLoading}
                    className="text-xs text-violet-600 hover:text-violet-700 flex items-center gap-1 disabled:opacity-50"
                  >
                    {flightScanLoading
                      ? <><span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" /> Scanning…</>
                      : <><Wand2 className="w-3 h-3" /> AI Auto-fill</>}
                  </button>
                  <button onClick={openEditFlight} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                </div>
              ) : undefined}
            >
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Plane className="w-4 h-4 text-slate-400" /> Flights
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              {flights.length === 0 && (
                <p className="px-4 py-3 text-xs text-slate-400">No flights recorded</p>
              )}
              {flights.map((f) => (
                <div key={f.id as string} className="px-4 py-3 border-b border-slate-100 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900 font-mono">{f.flightNo as string}</span>
                    <span className="text-xs text-slate-400">{formatDate(f.date as string)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <span className="font-medium">{f.fromApt as string}</span>
                    <span>{f.depTime as string}</span>
                    <ChevronRight className="w-3 h-3" />
                    <span className="font-medium">{f.toApt as string}</span>
                    <span>{f.arrTime as string}</span>
                  </div>
                  {f.airline && <p className="text-xs text-slate-400 mt-0.5">{f.airline as string}</p>}
                  {f.notes && <p className="text-xs text-amber-600 mt-0.5">{f.notes as string}</p>}
                </div>
              ))}
            </CardBody>
          </Card>

          {/* Hotels */}
          <Card>
            <CardHeader
              action={canEditBooking ? (
                <div className="flex items-center gap-3">
                  <button onClick={() => setAiAccomOpen(true)} className="text-xs text-violet-600 hover:text-violet-700 flex items-center gap-1">
                    <Wand2 className="w-3 h-3" /> AI Auto-fill
                  </button>
                  <button onClick={() => {
                    const edits: Record<string, unknown> = {}
                    accommodations.forEach((a) => { edits[a.id] = { hotel: a.hotel, roomType: a.roomType ?? '', address: a.address ?? '', contact: a.contact ?? '' } })
                    setAccomEdits(edits)
                    setDeletedAccomIds([])
                    setNewAccoms([])
                    setEditAccomModal(true)
                  }} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                </div>
              ) : undefined}
            >
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Hotel className="w-4 h-4 text-slate-400" /> Accommodation
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              {accommodations.map((a) => {
                const own = isOwnArrangement(a)
                return (
                <div key={a.id as string} className="px-4 py-3 border-b border-slate-100 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{(a.hotel as string) || <span className="text-slate-400 italic">Hotel not specified</span>}</p>
                    <span className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      own ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`} title={own ? 'Accommodation arranged by the guest / agent' : 'Accommodation arranged by Apple Holidays'}>
                      {own ? <><Shield className="w-2.5 h-2.5" /> Own Arrangement</> : <><Hotel className="w-2.5 h-2.5" /> Company Arranged</>}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">{a.city as string} · {a.nights as number} nights</p>
                  {a.roomType && <p className="text-xs text-brand-600 font-medium">{a.roomType as string}</p>}
                  <p className="text-xs text-slate-400">{formatDate(a.checkIn as string)} → {formatDate(a.checkOut as string)}</p>
                  {a.contact && <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{a.contact as string}</p>}
                </div>
                )
              })}
            </CardBody>
          </Card>
        </div>

        {/* Contact Information — Agent & Tourist */}
        {canViewClientDetails && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Agent Contact */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-slate-400" /> Agent Contact
                    {booking.agent && <span className="text-xs text-slate-400 font-normal">— {booking.agent as string}</span>}
                  </h3>
                </CardHeader>
                <CardBody className="py-3 px-4">
                  {canEditBooking ? (
                    <div className="space-y-3">
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <Mail className="w-3.5 h-3.5" /> Email
                        </label>
                        <input className="form-input" type="email" placeholder="agent@example.com"
                          value={contactForm.agentEmail}
                          onChange={e => setContactForm(f => ({ ...f, agentEmail: e.target.value }))} />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <Phone className="w-3.5 h-3.5" /> Phone
                        </label>
                        <input className="form-input" type="tel" placeholder="+94 77 123 4567"
                          value={contactForm.agentPhone}
                          onChange={e => {
                            const phone = e.target.value
                            setContactForm(f => ({
                              ...f,
                              agentPhone: phone,
                              agentWhatsapp: f.agentWhatsapp ? f.agentWhatsapp : phone.replace(/\+/g, ''),
                            }))
                          }} />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <MessageCircle className="w-3.5 h-3.5 text-green-500" /> WhatsApp
                        </label>
                        <input className="form-input" type="tel" placeholder="94771234567 (no +)"
                          value={contactForm.agentWhatsapp}
                          onChange={e => setContactForm(f => ({ ...f, agentWhatsapp: e.target.value.replace(/\+/g, '') }))} />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <MapPin className="w-3.5 h-3.5" /> Office Address
                        </label>
                        <textarea className="form-textarea resize-none text-sm" rows={2} placeholder="Agent office address"
                          value={contactForm.agentAddress}
                          onChange={e => setContactForm(f => ({ ...f, agentAddress: e.target.value }))} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {booking.agentEmail && (
                        <div className="flex items-center gap-3">
                          <Mail className="w-4 h-4 text-slate-300 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400">Email</p>
                            <a href={`mailto:${booking.agentEmail as string}`} className="text-sm text-brand-600 hover:underline truncate block">{booking.agentEmail as string}</a>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(booking.agentEmail as string); toast.success('Email copied') }} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {booking.agentPhone && (
                        <div className="flex items-center gap-3">
                          <Phone className="w-4 h-4 text-slate-300 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400">Phone</p>
                            <a href={`tel:${booking.agentPhone as string}`} className="text-sm text-slate-700 hover:underline">{booking.agentPhone as string}</a>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(booking.agentPhone as string); toast.success('Phone copied') }} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {booking.agentWhatsapp && (
                        <div className="flex items-center gap-3">
                          <MessageCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400">WhatsApp</p>
                            <span className="text-sm text-slate-700">{booking.agentWhatsapp as string}</span>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(booking.agentWhatsapp as string); toast.success('WhatsApp number copied') }} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {booking.agentAddress && (
                        <div className="flex items-start gap-3">
                          <MapPin className="w-4 h-4 text-slate-300 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400">Office Address</p>
                            <p className="text-sm text-slate-700 whitespace-pre-line leading-snug">{booking.agentAddress as string}</p>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(booking.agentAddress as string); toast.success('Address copied') }} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {!booking.agentEmail && !booking.agentPhone && !booking.agentWhatsapp && !booking.agentAddress && (
                        <p className="text-xs text-slate-400 italic">No agent contact info</p>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* Guest / Tourist Contact */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-brand-400" /> Guest / Tourist Contact
                    {booking.contactCountry && <span className="text-xs text-slate-400 font-normal">— {booking.contactCountry as string}</span>}
                  </h3>
                </CardHeader>
                <CardBody className="py-3 px-4">
                  {canEditBooking ? (
                    <div className="space-y-3">
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <Mail className="w-3.5 h-3.5" /> Email
                        </label>
                        <input className="form-input" type="email" placeholder="customer@example.com"
                          value={contactForm.contactEmail}
                          onChange={e => setContactForm(f => ({ ...f, contactEmail: e.target.value }))} />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <Phone className="w-3.5 h-3.5" /> Phone
                        </label>
                        <input className="form-input" type="tel" placeholder="+94 77 123 4567"
                          value={contactForm.contactPhone}
                          onChange={e => {
                            const phone = e.target.value
                            setContactForm(f => ({
                              ...f,
                              contactPhone: phone,
                              contactWhatsapp: f.contactWhatsapp ? f.contactWhatsapp : phone.replace(/\+/g, ''),
                            }))
                          }} />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <MessageCircle className="w-3.5 h-3.5 text-green-500" /> WhatsApp
                        </label>
                        <input className="form-input" type="tel" placeholder="94771234567 (no +)"
                          value={contactForm.contactWhatsapp}
                          onChange={e => setContactForm(f => ({ ...f, contactWhatsapp: e.target.value.replace(/\+/g, '') }))} />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                          <MapPin className="w-3.5 h-3.5" /> Home Address
                        </label>
                        <textarea className="form-textarea resize-none text-sm" rows={2} placeholder="Customer home/mailing address"
                          value={contactForm.contactAddress}
                          onChange={e => setContactForm(f => ({ ...f, contactAddress: e.target.value }))} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {booking.contactEmail && (
                        <div className="flex items-center gap-3">
                          <Mail className="w-4 h-4 text-slate-300 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400">Email</p>
                            <a href={`mailto:${booking.contactEmail as string}`} className="text-sm text-brand-600 hover:underline truncate block">{booking.contactEmail as string}</a>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(booking.contactEmail as string); toast.success('Email copied') }} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {booking.contactPhone && (
                        <div className="flex items-center gap-3">
                          <Phone className="w-4 h-4 text-slate-300 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400">Phone</p>
                            <a href={`tel:${booking.contactPhone as string}`} className="text-sm text-slate-700 hover:underline">{booking.contactPhone as string}</a>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(booking.contactPhone as string); toast.success('Phone copied') }} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {booking.contactWhatsapp && (
                        <div className="flex items-center gap-3">
                          <MessageCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400">WhatsApp</p>
                            <span className="text-sm text-slate-700">{booking.contactWhatsapp as string}</span>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(booking.contactWhatsapp as string); toast.success('WhatsApp number copied') }} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {booking.contactAddress && (
                        <div className="flex items-start gap-3">
                          <MapPin className="w-4 h-4 text-slate-300 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400">Home Address</p>
                            <p className="text-sm text-slate-700 whitespace-pre-line leading-snug">{booking.contactAddress as string}</p>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(booking.contactAddress as string); toast.success('Address copied') }} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {!booking.contactEmail && !booking.contactPhone && !booking.contactWhatsapp && !booking.contactAddress && (
                        <p className="text-xs text-slate-400 italic">No guest contact info</p>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>

            {/* Save button — only for edit-capable roles */}
            {canEditBooking && (
              <div className="flex justify-end">
                <Button loading={savingContact} onClick={saveContactEdits} size="sm">
                  Save Contact Info
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Emergency Contacts (visible to staff, not clients) */}
        {canViewClientDetails && emergencyContacts.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Shield className="w-4 h-4 text-red-400" /> Emergency Contacts
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-slate-100">
                {emergencyContacts.map((c) => (
                  <div key={c.id as string} className="flex items-center gap-4 px-4 py-3">
                    <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                      <Phone className="w-4 h-4 text-red-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{c.name as string}</p>
                      <p className="text-xs text-slate-500">{c.relationship as string}</p>
                    </div>
                    <a href={`tel:${c.phone as string}`} className="text-sm font-mono text-brand-600 hover:underline">
                      {c.phone as string}
                    </a>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Itinerary */}
        {itinerary.length > 0 && (
          <Card>
            <CardHeader><h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" /> Itinerary ({itinerary.length} days)
            </h3></CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-slate-100">
                {itinerary.map((item) => (
                  <div key={item.id as string} className="flex gap-4 px-6 py-4">
                    <div className="flex-shrink-0 text-center">
                      <div className="w-9 h-9 rounded-full bg-brand-50 border-2 border-brand-200 flex items-center justify-center">
                        <span className="text-brand-700 text-xs font-bold">D{item.dayNo as number}</span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{item.title as string}</p>
                        <span className="text-xs text-slate-400">{formatDate(item.date as string)}</span>
                      </div>
                      {item.description && <p className="text-xs text-slate-500 mt-1">{item.description as string}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Package & Notes sections — show if any are populated */}
        {(booking.valueAddedServices || booking.packageIncludes || booking.packageExcludes ||
          booking.importantNotes || booking.tips || booking.otherNote || booking.clientRequest ||
          booking.terms || booking.exclusions || booking.policyNotes) && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" /> Package Details &amp; Notes
              </h3>
            </CardHeader>
            <CardBody className="space-y-4">
              {[
                { label: 'Value Added Services',      value: booking.valueAddedServices },
                { label: 'Above Package Includes',    value: booking.packageIncludes },
                { label: 'The Above Package Excludes',value: booking.packageExcludes },
                { label: 'Terms & Conditions',        value: booking.terms },
                { label: 'Exclusions',                value: booking.exclusions },
                { label: 'Policy Notes',              value: booking.policyNotes },
                { label: 'Important Notes',           value: booking.importantNotes },
                { label: 'Tips',                      value: booking.tips },
                { label: 'Other Note',                value: booking.otherNote },
                { label: 'Client Request',            value: booking.clientRequest },
              ].filter(f => f.value).map(f => (
                <div key={f.label}>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">{f.label}</p>
                  <p className="text-sm text-slate-700 whitespace-pre-line">{f.value as string}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        {/* P&L Summary (if available + permitted) */}
        {pnl && (
          <Card>
            <CardHeader
              action={
                <Link href={`/dashboard/bookings/${ref}/pnl`} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                  Full P&L <ChevronRight className="w-3 h-3" />
                </Link>
              }
            >
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-slate-400" /> P&L Summary
              </h3>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-xs text-slate-500">Revenue</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(pnl.totalRevenue as number)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Cost</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(pnl.totalCost as number)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Profit</p>
                  <p className={`text-xl font-bold mt-1 ${(pnl.profit as number) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(pnl.profit as number)}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Accounts PNL (Reetha) — auto-linked or manually linked external record */}
        {['AC_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
          <ExternalPnlPanel bookingRef={ref} role={role} />
        )}

        {/* Driver Advance Sheet (Sri Lanka) — tour & fuel advances derived from the Accounts PNL */}
        {booking.operationCountry === 'SRILANKA'
          && ['AC_USER', 'BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
          <DriverLogPanel bookingRef={ref} role={role} />
        )}

        {/* Status history */}
        <Card>
          <CardHeader><h3 className="text-sm font-semibold text-slate-900">Activity Log</h3></CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-slate-100">
              {statusEvents.slice(0, 8).map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 px-6 py-3">
                  <div className="w-2 h-2 rounded-full bg-brand-400 mt-1.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-slate-700">
                      <span className="font-medium">{ev.actor?.name}</span>
                      {' '}{ev.toState}
                      {Boolean(ev.note) && <span className="text-slate-500"> — {String(ev.note)}</span>}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(ev.createdAt, 'dd MMM yyyy, HH:mm')}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* OneDrive folder picker */}
      {folderEditOpen && (
        <OneDriveFolderPicker
          open={folderEditOpen}
          onClose={() => setFolderEditOpen(false)}
          onSelect={(url) => saveFolder(url || null)}
          bookingRef={ref}
          isNumber={booking?.isNumber}
          agentBookingId={booking?.agentBookingId}
          arrivalDate={booking?.arrivalDate ? new Date(booking.arrivalDate).toISOString().slice(0, 10) : undefined}
          currentUrl={booking?.onedriveFolderUrl ? String(booking.onedriveFolderUrl) : null}
        />
      )}

      {/* Change request / Client Confirm modal */}
      <Modal
        open={changeModal}
        onClose={() => setChangeModal(false)}
        title={
          pendingAction === 'verify' ? 'Confirm Client Confirmation' :
          pendingAction === 'resubmit' ? 'Resubmit with Correction Note' :
          'Request Changes from Booking Team'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setChangeModal(false)}>Cancel</Button>
            <Button
              loading={!!actionLoading}
              variant={pendingAction === 'change-request' ? 'danger' : 'primary'}
              onClick={() => {
                doTransition(pendingAction, { notes: note, note }).then(() => { setChangeModal(false); setNote('') })
              }}
            >
              {pendingAction === 'verify' ? 'Confirm' : pendingAction === 'resubmit' ? 'Resubmit' : 'Send Request'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {pendingAction === 'verify' && (
            <p className="text-sm text-slate-600 bg-teal-50 border border-teal-100 rounded-lg px-4 py-3">
              Confirm that you have spoken with the agent/client and they have confirmed the booking details.
            </p>
          )}
          <div>
            <label className="form-label">
              {pendingAction === 'verify' ? 'Confirmation notes (optional)' :
               pendingAction === 'resubmit' ? 'What was corrected?' :
               'What needs to be changed?'}
            </label>
            <textarea
              className="form-textarea"
              rows={4}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={
                pendingAction === 'verify' ? 'e.g. Spoke with Vikas, all details confirmed, reconfirm call on Day-1...' :
                pendingAction === 'resubmit' ? 'Describe the correction made...' :
                'Describe the change required...'
              }
            />
          </div>
        </div>
      </Modal>

      {/* Edit Booking Modal */}
      <Modal
        open={editBookingModal}
        onClose={() => setEditBookingModal(false)}
        title="Edit Booking Details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditBookingModal(false)}>Cancel</Button>
            <Button loading={savingBooking} onClick={saveBookingEdits}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="form-label">Agent / Company</label>
              <input className="form-input" value={bookingForm.agent}
                onChange={e => setBookingForm(f => ({ ...f, agent: e.target.value }))} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="form-label">File Handler</label>
              <input className="form-input" value={bookingForm.fileHandler}
                onChange={e => setBookingForm(f => ({ ...f, fileHandler: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Agent Booking ID</label>
              <input className="form-input" value={bookingForm.agentBookingId}
                onChange={e => setBookingForm(f => ({ ...f, agentBookingId: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Currency</label>
              <select className="form-select" value={bookingForm.currency}
                onChange={e => setBookingForm(f => ({ ...f, currency: e.target.value }))}>
                {['USD', 'AUD', 'SGD', 'GBP', 'EUR', 'INR', 'VND'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Arrival Date</label>
              <input type="date" className="form-input" value={bookingForm.arrivalDate}
                onChange={e => setBookingForm(f => ({ ...f, arrivalDate: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Departure Date</label>
              <input type="date" className="form-input" value={bookingForm.departureDate}
                onChange={e => setBookingForm(f => ({ ...f, departureDate: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Adults</label>
              <input type="number" min="0" className="form-input" value={bookingForm.paxAdults}
                onChange={e => setBookingForm(f => ({ ...f, paxAdults: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Children</label>
              <input type="number" min="0" className="form-input" value={bookingForm.paxChildren}
                onChange={e => setBookingForm(f => ({ ...f, paxChildren: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Infants</label>
              <input type="number" min="0" className="form-input" value={bookingForm.paxInfants}
                onChange={e => setBookingForm(f => ({ ...f, paxInfants: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Quoted Total</label>
              <input type="number" className="form-input" value={bookingForm.quotedTotal}
                onChange={e => setBookingForm(f => ({ ...f, quotedTotal: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Terms & Conditions</label>
              <textarea rows={3} className="form-textarea" value={bookingForm.terms}
                onChange={e => setBookingForm(f => ({ ...f, terms: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Exclusions</label>
              <textarea rows={2} className="form-textarea" value={bookingForm.exclusions}
                onChange={e => setBookingForm(f => ({ ...f, exclusions: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Value Added Services</label>
              <textarea rows={2} className="form-textarea" value={bookingForm.valueAddedServices}
                onChange={e => setBookingForm(f => ({ ...f, valueAddedServices: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Above Package Includes</label>
              <textarea rows={3} className="form-textarea" value={bookingForm.packageIncludes}
                onChange={e => setBookingForm(f => ({ ...f, packageIncludes: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">The Above Package Excludes</label>
              <textarea rows={3} className="form-textarea" value={bookingForm.packageExcludes}
                onChange={e => setBookingForm(f => ({ ...f, packageExcludes: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Important Notes</label>
              <textarea rows={2} className="form-textarea" value={bookingForm.importantNotes}
                onChange={e => setBookingForm(f => ({ ...f, importantNotes: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Tips</label>
              <textarea rows={2} className="form-textarea" value={bookingForm.tips}
                onChange={e => setBookingForm(f => ({ ...f, tips: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Other Note</label>
              <textarea rows={2} className="form-textarea" value={bookingForm.otherNote}
                onChange={e => setBookingForm(f => ({ ...f, otherNote: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Client Request</label>
              <textarea rows={2} className="form-textarea" value={bookingForm.clientRequest}
                onChange={e => setBookingForm(f => ({ ...f, clientRequest: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="form-label">Amendment Note</label>
              <input className="form-input" placeholder="e.g. Room upgrade requested"
                value={bookingForm.amendmentNote}
                onChange={e => setBookingForm(f => ({ ...f, amendmentNote: e.target.value }))} />
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit Accommodation Modal */}
      <Modal
        open={editAccomModal}
        onClose={() => { setEditAccomModal(false); setNewAccoms([]); setAccomEdits({}); setDeletedAccomIds([]) }}
        title="Edit Accommodation Details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setEditAccomModal(false); setNewAccoms([]); setAccomEdits({}); setDeletedAccomIds([]) }}>Cancel</Button>
            <Button loading={savingAccom} onClick={saveAccomEdits}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-5">
          <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            Use this for critical room or hotel changes only. P&L is not automatically updated.
          </p>
          {accommodations
            .filter((a) => !deletedAccomIds.includes(a.id as string))
            .map((a) => (
            <div key={a.id as string} className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {a.city as string} · {formatDate(a.checkIn as string)} – {formatDate(a.checkOut as string)}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Delete accommodation "${String(a.hotel ?? a.city ?? 'this stay')}"?`)) return
                    setDeletedAccomIds(prev => prev.includes(a.id as string) ? prev : [...prev, a.id as string])
                    setAccomEdits(prev => {
                      const next = { ...prev }
                      delete next[a.id as string]
                      return next
                    })
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-md transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="form-label">Hotel Name</label>
                  <input className="form-input"
                    value={(accomEdits[a.id as string]?.hotel ?? a.hotel) as string}
                    onChange={e => setAccomEdits(prev => ({ ...prev, [a.id as string]: { ...prev[a.id as string], hotel: e.target.value } }))} />
                </div>
                <div>
                  <label className="form-label">Room Type</label>
                  <input className="form-input" placeholder="e.g. Deluxe Twin"
                    value={(accomEdits[a.id as string]?.roomType ?? a.roomType ?? '') as string}
                    onChange={e => setAccomEdits(prev => ({ ...prev, [a.id as string]: { ...prev[a.id as string], roomType: e.target.value } }))} />
                </div>
                <div>
                  <label className="form-label">Contact Number</label>
                  <input className="form-input" placeholder="+84 ..."
                    value={(accomEdits[a.id as string]?.contact ?? a.contact ?? '') as string}
                    onChange={e => setAccomEdits(prev => ({ ...prev, [a.id as string]: { ...prev[a.id as string], contact: e.target.value } }))} />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Address</label>
                  <input className="form-input"
                    value={(accomEdits[a.id as string]?.address ?? a.address ?? '') as string}
                    onChange={e => setAccomEdits(prev => ({ ...prev, [a.id as string]: { ...prev[a.id as string], address: e.target.value } }))} />
                </div>
              </div>
            </div>
          ))}

          {/* New hotel rows */}
          {newAccoms.map((newA, idx) => (
            <div key={idx} className="border border-brand-200 bg-brand-50/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide">New Hotel</p>
                <button
                  type="button"
                  onClick={() => setNewAccoms(prev => prev.filter((_, i) => i !== idx))}
                  className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">City *</label>
                  <input className="form-input" placeholder="e.g. Kuala Lumpur"
                    value={newA.city}
                    onChange={e => setNewAccoms(prev => prev.map((a, i) => i === idx ? { ...a, city: e.target.value } : a))} />
                </div>
                <div>
                  <label className="form-label">Room Type</label>
                  <input className="form-input" placeholder="e.g. Deluxe Twin"
                    value={newA.roomType}
                    onChange={e => setNewAccoms(prev => prev.map((a, i) => i === idx ? { ...a, roomType: e.target.value } : a))} />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Hotel Name *</label>
                  <input className="form-input" placeholder="e.g. Holiday Inn Express..."
                    value={newA.hotel}
                    onChange={e => setNewAccoms(prev => prev.map((a, i) => i === idx ? { ...a, hotel: e.target.value } : a))} />
                </div>
                <div>
                  <label className="form-label">Check-in *</label>
                  <input type="date" className="form-input"
                    value={newA.checkIn}
                    onChange={e => setNewAccoms(prev => prev.map((a, i) => i === idx ? { ...a, checkIn: e.target.value } : a))} />
                </div>
                <div>
                  <label className="form-label">Check-out *</label>
                  <input type="date" className="form-input"
                    value={newA.checkOut}
                    onChange={e => setNewAccoms(prev => prev.map((a, i) => i === idx ? { ...a, checkOut: e.target.value } : a))} />
                </div>
                <div>
                  <label className="form-label">Meal Plan</label>
                  <input className="form-input" placeholder="e.g. Bed & Breakfast"
                    value={newA.mealType}
                    onChange={e => setNewAccoms(prev => prev.map((a, i) => i === idx ? { ...a, mealType: e.target.value } : a))} />
                </div>
                <div>
                  <label className="form-label">Contact Number</label>
                  <input className="form-input" placeholder="+60 ..."
                    value={newA.contact}
                    onChange={e => setNewAccoms(prev => prev.map((a, i) => i === idx ? { ...a, contact: e.target.value } : a))} />
                </div>
                <div>
                  <label className="form-label">Address</label>
                  <input className="form-input"
                    value={newA.address}
                    onChange={e => setNewAccoms(prev => prev.map((a, i) => i === idx ? { ...a, address: e.target.value } : a))} />
                </div>
              </div>
            </div>
          ))}

          {/* Add hotel button */}
          <button
            type="button"
            onClick={() => setNewAccoms(prev => [...prev, { city: '', hotel: '', checkIn: '', checkOut: '', roomType: '', mealType: '', contact: '', address: '' }])}
            className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Another Hotel
          </button>
        </div>
      </Modal>

      {/* Edit Passenger Modal */}
      <Modal
        open={editPassengerModal}
        onClose={() => { setEditPassengerModal(false); setPassengerEditList([]) }}
        title="Edit Passengers"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setEditPassengerModal(false); setPassengerEditList([]) }}>Cancel</Button>
            <Button loading={savingPassengers} onClick={savePassengerEdits}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-5">
          <p className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
            Edit passenger details, add new passengers, or remove passengers from this booking.
          </p>

          <div className="space-y-3">
            {passengerEditList.filter(p => !p._deleted).map((p, idx) => (
              <div key={p._key} className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Passenger {idx + 1}{p._isNew ? ' · New' : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Delete passenger "${p.name || 'this passenger'}"?`)) return
                      deletePassengerRow(p._key)
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="form-label">Name *</label>
                    <input
                      className="form-input"
                      value={p.name}
                      onChange={e => updatePassengerRow(p._key, 'name', e.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="form-label">Type</label>
                    <select
                      className="form-select"
                      value={p.type}
                      onChange={e => updatePassengerRow(p._key, 'type', e.target.value)}
                    >
                      <option value="ADULT">Adult</option>
                      <option value="CHILD">Child</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Age</label>
                    <input
                      type="number"
                      className="form-input"
                      value={p.age}
                      onChange={e => updatePassengerRow(p._key, 'age', e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="form-label">Passport</label>
                    <input
                      className="form-input"
                      value={p.passport}
                      onChange={e => updatePassengerRow(p._key, 'passport', e.target.value)}
                      placeholder="Passport no."
                    />
                  </div>
                  <div>
                    <label className="form-label">Nationality</label>
                    <input
                      className="form-input"
                      value={p.nationality}
                      onChange={e => updatePassengerRow(p._key, 'nationality', e.target.value)}
                      placeholder="Nationality"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="form-label">Contact</label>
                    <input
                      className="form-input"
                      value={p.contact}
                      onChange={e => updatePassengerRow(p._key, 'contact', e.target.value)}
                      placeholder="Phone number"
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={p.isLead}
                        onChange={e => updatePassengerRow(p._key, 'isLead', e.target.checked)}
                      />
                      Lead passenger
                    </label>
                  </div>
                </div>
              </div>
            ))}

            <Button type="button" variant="ghost" size="sm" icon={<Plus className="w-3 h-3" />}
              onClick={addPassengerRow}>
              Add Passenger
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel modal */}
      <Modal
        open={cancelModal}
        onClose={() => setCancelModal(false)}
        title="Request Booking Cancellation"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelModal(false)}>Keep Booking</Button>
            <Button
              variant="danger"
              loading={actionLoading === 'cancel'}
              onClick={() => {
                const reason = (cancelReason || DEFAULT_CANCEL_REASON).trim()
                if (!reason) { toast.error('Please provide a reason'); return }
                doTransition('cancel', { reason }).then(() => { setCancelModal(false); setCancelReason('') })
              }}
            >
              Send for Accounts Approval
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
              You are requesting cancellation of {ref}
            </p>
            <p className="mt-1 text-xs text-red-600 leading-relaxed">
              The booking is not cancelled straight away. It moves to <strong>Pending Approval —
              Accounts Team</strong> and the accounts desk is emailed. Once they approve, the booking
              becomes <strong>Confirmed Cancellation</strong> and the cancellation notice is sent
              automatically.
            </p>
          </div>

          {daysUntil <= 21 && daysUntil > 0 && (
            <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-orange-700 font-medium">
                Warning: 100% cancellation penalty applies (within 21-day window)
              </p>
            </div>
          )}

          {/* Auto-filled from the signed-in account — read only */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Requested By</label>
              <input className="form-input bg-slate-50 text-slate-600 cursor-not-allowed"
                value={session?.user?.name ?? '—'} readOnly disabled />
            </div>
            <div>
              <label className="form-label">Account Email</label>
              <input className="form-input bg-slate-50 text-slate-600 cursor-not-allowed"
                value={session?.user?.email ?? '—'} readOnly disabled />
            </div>
          </div>

          <div>
            <label className="form-label">Reason to Cancel Booking *</label>
            <textarea className="form-textarea" rows={3}
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder={DEFAULT_CANCEL_REASON} />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400">
                Leave blank to use the default reason.
              </p>
              {cancelReason !== DEFAULT_CANCEL_REASON && (
                <button type="button"
                  onClick={() => setCancelReason(DEFAULT_CANCEL_REASON)}
                  className="text-[11px] font-medium text-brand-600 hover:underline">
                  Use default reason
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
            An approval request goes to the accounts team now. The full cancellation notice
            (you + the operations desk — Senthoor, Venkadesh, Amala, Mahamood, Shahila, Shafiya)
            is sent automatically once accounts approve.
          </p>
        </div>
      </Modal>

      {/* ── Customer Feedback Modal (Complete Trip) ─────────────────── */}
      <Modal
        open={feedbackModal}
        onClose={() => setFeedbackModal(false)}
        title={status === 'COMPLETED' ? 'Customer Feedback' : 'Customer Feedback — Complete Trip'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFeedbackModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={feedbackSaving}
              onClick={saveFeedbackAndComplete}
            >
              {status === 'COMPLETED' ? 'Save Feedback' : <>Save &amp; Complete Trip</>}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              {status === 'COMPLETED'
                ? 'Update the customer feedback recorded for this trip. It stays visible on the booking details page.'
                : "Record the customer's feedback before completing the trip. This will be saved by the TE team."}
            </p>
          </div>

          {/* Star rating */}
          <div>
            <label className="form-label mb-2">Customer Rating</label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setFeedbackRating(star === feedbackRating ? 0 : star)}
                  className={`text-2xl transition-transform hover:scale-110 ${
                    star <= feedbackRating ? 'text-yellow-400' : 'text-slate-200'
                  }`}
                >
                  ★
                </button>
              ))}
              {feedbackRating > 0 && (
                <span className="text-sm text-slate-500 ml-1">{feedbackRating} / 5</span>
              )}
            </div>
          </div>

          {/* Comment */}
          <div>
            <label className="form-label">Customer Review / Comment</label>
            <textarea
              className="form-textarea"
              rows={4}
              placeholder="Write the customer's feedback here..."
              value={feedbackComment}
              onChange={e => setFeedbackComment(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* ── Edit Flight Details Modal ────────────────────────────────── */}
      <Modal
        open={editFlightModal}
        onClose={() => setEditFlightModal(false)}
        title="Update Flight Details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditFlightModal(false)}>Cancel</Button>
            <Button loading={savingFlights} onClick={saveFlightEdits}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Use for emergency flight changes only — cancellations, reschedules, or missing flights.
              This change will be recorded in the activity log.
            </p>
          </div>

          <div>
            <label className="form-label">Reason for change *</label>
            <textarea
              className="form-textarea"
              rows={2}
              placeholder="e.g. Flight VN123 cancelled — replaced with VN456 departing 14:30"
              value={flightChangeReason}
              onChange={e => setFlightChangeReason(e.target.value)}
            />
          </div>

          <div className="space-y-4">
            {flightEditList.filter(f => !f._deleted).map((f) => (
              <div key={f._key} className={`border rounded-xl p-4 space-y-3 ${f._isNew ? 'border-brand-300 bg-brand-50/30' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {f._isNew ? 'New Flight' : `Flight ${f.flightNo || '—'}`}
                  </span>
                  <button
                    onClick={() => removeFlight(f._key)}
                    className="text-red-400 hover:text-red-600 flex items-center gap-1 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {f._isNew ? 'Remove' : 'Delete'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Flight No *</label>
                    <input className="form-input font-mono" placeholder="e.g. VN123"
                      value={f.flightNo}
                      onChange={e => updateFlight(f._key, 'flightNo', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Date *</label>
                    <input type="date" className="form-input"
                      value={f.date}
                      onChange={e => updateFlight(f._key, 'date', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">From Airport *</label>
                    <input className="form-input uppercase" placeholder="e.g. CMB"
                      value={f.fromApt}
                      onChange={e => updateFlight(f._key, 'fromApt', e.target.value.toUpperCase())} />
                  </div>
                  <div>
                    <label className="form-label">Departure Time *</label>
                    <input className="form-input" placeholder="e.g. 08:30"
                      value={f.depTime}
                      onChange={e => updateFlight(f._key, 'depTime', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">To Airport *</label>
                    <input className="form-input uppercase" placeholder="e.g. HAN"
                      value={f.toApt}
                      onChange={e => updateFlight(f._key, 'toApt', e.target.value.toUpperCase())} />
                  </div>
                  <div>
                    <label className="form-label">Arrival Time *</label>
                    <input className="form-input" placeholder="e.g. 14:45"
                      value={f.arrTime}
                      onChange={e => updateFlight(f._key, 'arrTime', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Airline</label>
                    <input className="form-input" placeholder="e.g. Vietnam Airlines"
                      value={f.airline}
                      onChange={e => updateFlight(f._key, 'airline', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Notes</label>
                    <input className="form-input" placeholder="e.g. Rescheduled due to cancellation"
                      value={f.notes}
                      onChange={e => updateFlight(f._key, 'notes', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addNewFlight}
            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Replacement Flight
          </button>
        </div>
      </Modal>

      {/* ── AI Auto-fill popups (Passengers · Flights · Accommodation) ─── */}
      <AiAutofillModal<ExtractedPassenger>
        open={aiPassengerOpen}
        onClose={() => setAiPassengerOpen(false)}
        title="AI Passenger Auto-fill"
        description="Upload a passenger list, passport or ticket image/PDF, or paste passenger text — AI reads it, corrects it, and fills the passengers for you."
        endpoint={`/api/bookings/${ref}/passengers/extract`}
        resultKey="passengers"
        itemNoun="passenger"
        pastePlaceholder={'Paste passenger details, e.g.\n1. Mr Chandilya Gogoi — Adult, IND, P1234567\n2. Ms Rhea Gogoi — Child, age 9'}
        onApply={applyExtractedPassengers}
        renderItem={(p) => (
          <>
            <div className="flex items-center justify-between">
              <span className="text-cyan-200 font-bold">{p.name || 'Passenger'}</span>
              <span className="text-slate-500 text-xs">{p.type || 'ADULT'}{p.age ? ` · ${p.age}y` : ''}</span>
            </div>
            <p className="text-slate-400 text-xs mt-1">
              {[p.passport, p.nationality, p.contact].filter(Boolean).join(' · ') || 'No passport / nationality read'}
            </p>
          </>
        )}
      />

      <AiAutofillModal<ExtractedFlight>
        open={aiFlightOpen}
        onClose={() => setAiFlightOpen(false)}
        title="AI Flight Auto-fill"
        description="Upload a ticket/itinerary image or PDF, or paste flight text — AI reads it, corrects it, and fills the flights for you."
        endpoint={`/api/bookings/${ref}/flights/extract`}
        resultKey="flights"
        itemNoun="flight"
        pastePlaceholder={'Paste flight details, e.g.\n6E 1631  02 Sep  CCU 14:10 → HAN 18:35\nIndiGo, Terminal 2'}
        onApply={applyExtractedFlights}
        onPickFromDrive={() => setFlightDrivePickerOpen(true)}
        renderItem={(f) => (
          <>
            <div className="flex items-center justify-between">
              <span className="text-cyan-200 font-bold">{f.flightNo || 'Flight'}</span>
              <span className="text-slate-500 text-xs">{f.date}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-white">
              <span className="font-bold">{f.fromApt || '—'}</span>
              <span className="text-slate-500 text-xs">{f.depTime}</span>
              <Plane className="w-3.5 h-3.5 text-cyan-400/60" />
              <span className="text-slate-500 text-xs">{f.arrTime}</span>
              <span className="font-bold">{f.toApt || '—'}</span>
              {f.airline && <span className="ml-auto text-slate-500 text-xs">{f.airline}</span>}
            </div>
          </>
        )}
      />

      <AiAutofillModal<ExtractedAccommodation>
        open={aiAccomOpen}
        onClose={() => setAiAccomOpen(false)}
        title="AI Hotel Auto-fill"
        description="Upload a hotel voucher or itinerary image/PDF, or paste hotel text — AI reads it, corrects it, and fills the accommodation for you."
        endpoint={`/api/bookings/${ref}/accommodations/extract`}
        resultKey="accommodations"
        itemNoun="hotel"
        pastePlaceholder={'Paste hotel details, e.g.\nThe Lapis Hotel, Hanoi\n02 Sep 2026 → 03 Sep 2026 · Deluxe Twin · BB'}
        onApply={applyExtractedAccommodations}
        renderItem={(a) => (
          <>
            <div className="flex items-center justify-between">
              <span className="text-cyan-200 font-bold">{a.hotel || 'Hotel'}</span>
              <span className="text-slate-500 text-xs">{a.city}</span>
            </div>
            <p className="text-white text-xs mt-1">{a.checkIn || '—'} → {a.checkOut || '—'}</p>
            {(a.roomType || a.mealType) && (
              <p className="text-slate-400 text-xs mt-0.5">{[a.roomType, a.mealType].filter(Boolean).join(' · ')}</p>
            )}
          </>
        )}
      />

      {/* CloudFilePicker for flight scan from OneDrive */}
      <CloudFilePicker
        open={flightDrivePickerOpen}
        onClose={() => setFlightDrivePickerOpen(false)}
        bookingRef={ref}
        filterExtensions={['.jpg', '.jpeg', '.png', '.webp', '.pdf']}
        title="Pick Flight File from OneDrive"
        selectLabel="Extract Flights"
        onSelect={(file) => handleFlightDriveFileSelected(file)}
      />

      {/* ── WhatsApp modal ────────────────────────────────────────────── */}
      <Modal
        open={waModal}
        onClose={() => setWaModal(false)}
        title="Send via WhatsApp"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWaModal(false)}>Cancel</Button>
            <Button
              loading={waSending}
              icon={<Send className="w-4 h-4" />}
              onClick={sendWhatsApp}
              className="bg-green-600 hover:bg-green-700 text-white border-green-700"
            >
              {waSending
                ? 'Sending…'
                : waPdfType === 'full'
                  ? 'Send Full Details + Vouchers'
                  : 'Send Tour Confirmation'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">

          {/* Queued-confirmation indicator — messages waiting for the customer
              to reply so their 24h window opens. */}
          {waQueue.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-xs font-semibold text-amber-800">
                  {waQueue.length} {waQueue.length === 1 ? 'message is' : 'messages are'} in the queue — waiting for the customer to reply
                </p>
              </div>
              {waQueue.map(q => (
                <div key={q.id} className="flex items-center justify-between gap-2 rounded bg-white/70 border border-amber-200 px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-amber-900 truncate">
                      {q.pdfType === 'full' ? 'Full Details + Vouchers' : q.pdfType === 'confirmation' ? 'Tour Confirmation' : 'Message'} · {q.phone}
                    </p>
                    <p className="text-[10px] text-amber-600">
                      Queued {new Date(q.queuedAt).toLocaleString()}{q.queuedBy ? ` · by ${q.queuedBy}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cancelWaQueued(q.id)}
                    className="text-[11px] font-semibold text-red-600 hover:text-red-700 flex-shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-amber-600 leading-relaxed">
                These send automatically the moment the customer messages back. You can cancel any that are no longer needed.
              </p>
            </div>
          )}

          {/* PDF Type Selector */}
          <div>
            <label className="form-label mb-1">Select Message Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => switchWaPdfType('confirmation')}
                className={`flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all ${
                  waPdfType === 'confirmation'
                    ? 'border-green-500 bg-green-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className={`text-xs font-bold uppercase tracking-wide ${waPdfType === 'confirmation' ? 'text-green-700' : 'text-slate-500'}`}>
                  Send 1 · T-7
                </span>
                <span className="text-sm font-semibold text-slate-800">Tour Confirmation</span>
                {daysUntil > 0 && (() => { const info = getAutoSendInfo(daysUntil, 7); return (
                  <span className={`text-[10px] font-semibold ${info.urgent ? 'text-red-500' : 'text-slate-400'}`}>
                    {info.label}
                  </span>
                )})()}
                <span className="text-xs text-slate-500 leading-relaxed">
                  Booking summary · Passengers · Accommodation · Itinerary · Tour Agenda · T&C
                </span>
              </button>

              <button
                type="button"
                onClick={() => switchWaPdfType('full')}
                className={`flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all ${
                  waPdfType === 'full'
                    ? 'border-green-500 bg-green-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className={`text-xs font-bold uppercase tracking-wide ${waPdfType === 'full' ? 'text-green-700' : 'text-slate-500'}`}>
                  Send 2 · T-3
                </span>
                <span className="text-sm font-semibold text-slate-800">Full Details + Vouchers</span>
                {daysUntil > 0 && (() => { const info = getAutoSendInfo(daysUntil, 3); return (
                  <span className={`text-[10px] font-semibold ${info.urgent ? 'text-red-500' : 'text-slate-400'}`}>
                    {info.label}
                  </span>
                )})()}
                <span className="text-xs text-slate-500 leading-relaxed">
                  All of Send 1 + Drivers · Tickets & voucher receipts (each on own page)
                </span>
              </button>
            </div>
          </div>

          {/* Test mode banner */}
          {testMode && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <FlaskConical className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs text-amber-700 font-medium">
                Test mode — sending to <strong>{testSettings.testWhatsapp}</strong> instead of real customer number.
              </p>
            </div>
          )}

          {/* Phone */}
          <div>
            <label className="form-label">Client WhatsApp / Phone Number *</label>
            {!testMode && availablePhones.length > 0 && (
              <select
                className="form-select mb-2"
                value=""
                onChange={e => { if (e.target.value) setWaPhone(e.target.value) }}
              >
                <option value="">— select from booking —</option>
                {availablePhones.map((opt, i) => (
                  <option key={i} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            <input
              type="tel"
              className="form-input"
              placeholder="e.g. 94771234567 (with country code, no +)"
              value={waPhone}
              onChange={e => setWaPhone(e.target.value)}
            />
          </div>

          {/* Cold-customer handling. If the customer hasn't messaged in 24h,
              "Send Tour Confirmation" now AUTO-sends a reply request and queues
              the confirmation (it delivers the moment they reply). The button
              below is an optional way to send just the reply request now. */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 space-y-2">
            <p className="text-xs text-blue-800 leading-relaxed">
              <strong>Outside the 24h window?</strong> No problem — sending the confirmation will
              automatically send the customer a reply request and <strong>queue</strong> your message;
              it delivers the moment they reply. Or send just a reply request now:
            </p>
            <Button
              variant="secondary"
              loading={waOpenerSending}
              icon={<Send className="w-4 h-4" />}
              onClick={sendWhatsAppOpener}
              className="border-blue-300 text-blue-700"
            >
              {waOpenerSending ? 'Sending…' : 'Send reply request'}
            </Button>
          </div>

          {/* Message */}
          <div>
            <label className="form-label">Message</label>
            <textarea
              className="form-textarea font-mono text-xs"
              rows={13}
              value={waMessage}
              onChange={e => setWaMessage(e.target.value)}
            />
          </div>

          {/* Attach PDF toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded accent-green-600"
              checked={waAttachPdf}
              onChange={e => setWaAttachPdf(e.target.checked)}
            />
            <span className="text-sm text-slate-700">
              Attach PDF&nbsp;
              <span className="text-slate-400 text-xs">
                ({waPdfType === 'full' ? 'Full Details & Vouchers' : 'Tour Confirmation'})
              </span>
            </span>
          </label>

          {/* Phone number hint */}
          <p className="text-xs text-slate-400 mt-1">Include country code without + (e.g. 94 = Sri Lanka · 91 = India · 61 = Australia)</p>

          {/* Info bar */}
          <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3 border border-slate-100 space-y-1">
            <div>
              Booking: <strong>{ref}</strong> · Lead:{' '}
              <strong>{(booking.passengers ?? []).find((p: { isLead: boolean; name: string }) => p.isLead)?.name ?? (booking.passengers?.[0]?.name ?? '—')}</strong>
            </div>
            {(booking.contactEmail || booking.agentEmail) && (
              <div className="flex items-center gap-1.5">
                <Mail className="w-3 h-3" />
                <span>Email:</span>{' '}
                <a
                  href={`mailto:${(booking.contactEmail ?? booking.agentEmail) as string}`}
                  className="text-brand-500 hover:underline"
                >
                  {(booking.contactEmail ?? booking.agentEmail) as string}
                </a>
              </div>
            )}
            {waPdfType === 'full' && (
              <div className="text-amber-600">· Ticket images will be embedded in the PDF</div>
            )}
          </div>
        </div>
      </Modal>

      {/* ── WhatsApp mini chat widget ─────────────────────────────────── */}
      {['TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
        <WhatsAppMiniChat bookingRef={ref} booking={booking} />
      )}

      {/* ── AI Calls & Feedback modal ──────────────────────────────────── */}
      {aiCallsModal && (
        <AICallsFeedbackModal
          open={aiCallsModal}
          onClose={() => setAiCallsModal(false)}
          bookingRef={ref}
          bookingInfo={{
            agentEmail:     booking.agentEmail   as string | null,
            contactEmail:   booking.contactEmail as string | null,
            agent:          booking.agent        as string | null,
            arrivalDate:    booking.arrivalDate  ? String(booking.arrivalDate) : null,
            departureDate:  booking.departureDate ? String(booking.departureDate) : null,
          }}
          testMode={testMode}
          testEmail1={testSettings.testEmail1}
          testEmail2={testSettings.testEmail2}
        />
      )}

      {/* ── Switch version confirm modal ──────────────────────────────── */}
      <Modal
        open={restoreTarget !== null}
        onClose={() => !restoringVersion && setRestoreTarget(null)}
        title={`Switch to version V${restoreTarget ?? ''}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestoreTarget(null)} disabled={restoringVersion}>Cancel</Button>
            <Button
              loading={restoringVersion}
              icon={<RotateCcw className="w-4 h-4" />}
              onClick={() => restoreTarget !== null && restoreVersion(restoreTarget)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700"
            >
              {restoringVersion ? 'Switching…' : `Switch to V${restoreTarget ?? ''}`}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            This will make <span className="font-semibold">V{restoreTarget}</span> the active version. The booking details,
            passengers, flights, hotels, itinerary and agenda will be rebuilt from that version.
          </p>
          <p className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
            Any driver/vehicle assignments on the current agenda may be lost. P&amp;L, tickets and payments are not affected.
            You can switch back to another version at any time.
          </p>
        </div>
      </Modal>

      {/* ── Send Email modal ───────────────────────────────────────────── */}
      <Modal
        open={emailModal}
        onClose={() => setEmailModal(false)}
        title="Send Confirmation Email"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEmailModal(false)}>Cancel</Button>
            <Button
              loading={emailSending}
              icon={<Send className="w-4 h-4" />}
              onClick={sendEmail}
              className="bg-blue-600 hover:bg-blue-700 text-white border-blue-700"
            >
              {emailSending ? 'Sending…' : 'Send Email'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">

          {/* Test mode banner */}
          {testMode && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
              <FlaskConical className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <div className="text-xs text-amber-700">
                <p className="font-semibold">Test Mode Active</p>
                <p>Email will be redirected to test addresses regardless of values below.</p>
              </div>
            </div>
          )}

          {/* To */}
          <div>
            <label className="form-label">To (Agent Email)</label>
            {!testMode && availableEmails.length > 1 && (
              <select
                className="form-select mb-2"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
              >
                <option value="">— select email —</option>
                {availableEmails.map((opt, i) => (
                  <option key={i} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-2 form-input bg-slate-50 text-slate-600 text-sm">
              <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="truncate">{testMode ? testSettings.testEmail1 : (emailTo || '— not set —')}</span>
              {testMode && <span className="ml-auto text-amber-500 text-xs font-medium flex-shrink-0">test</span>}
            </div>
            {!testMode && !emailTo && (
              <p className="text-xs text-red-500 mt-1">No agent email found in booking. Add it to the booking first.</p>
            )}
          </div>

          {/* CC */}
          <div>
            <label className="form-label">CC (extracted from booking)</label>
            {testMode ? (
              <div className="flex items-center gap-2 form-input bg-slate-50 text-slate-600 text-sm">
                <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="truncate">{testSettings.testEmail2}</span>
                <span className="ml-auto text-amber-500 text-xs font-medium flex-shrink-0">test</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {emailCc.length === 0 ? (
                  <p className="text-xs text-slate-400 italic px-1">No additional email addresses found in booking</p>
                ) : (
                  emailCc.map((addr, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 form-input bg-slate-50 text-slate-600 text-sm py-1.5">
                        <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <span className="truncate">{addr}</span>
                      </div>
                      <button
                        onClick={() => setEmailCc(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-slate-400 hover:text-red-500 flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
                <button
                  onClick={() => {
                    const email = prompt('Enter email address to add to CC:')
                    if (email && email.includes('@')) setEmailCc(prev => [...prev, email.trim()])
                  }}
                  className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 mt-1"
                >
                  <Plus className="w-3 h-3" /> Add CC address
                </button>
              </div>
            )}
          </div>

          {/* Booking info */}
          <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3 border border-slate-100 space-y-1">
            <div>Booking: <strong>{ref}</strong></div>
            <div>The PDF confirmation will be generated and attached automatically.</div>
            {booking.agent && <div>Agent: <strong>{booking.agent as string}</strong></div>}
          </div>
        </div>
      </Modal>

      {/* ── Edit Contact Info Modal ──────────────────────────────────── */}
      <Modal
        open={editContactModal}
        onClose={() => setEditContactModal(false)}
        title="Edit Contact Information"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditContactModal(false)}>Cancel</Button>
            <Button loading={savingContact} onClick={saveContactEdits}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-5">
          <p className="text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            Update the stored contact details for this booking. Saved numbers will appear as defaults in WhatsApp and Email send dialogs.
          </p>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Agent Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="form-label">Agent Email</label>
                <input className="form-input" type="email" placeholder="agent@example.com"
                  value={contactForm.agentEmail}
                  onChange={e => setContactForm(f => ({ ...f, agentEmail: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Agent Phone</label>
                <input className="form-input" type="tel" placeholder="+94 77 123 4567"
                  value={contactForm.agentPhone}
                  onChange={e => setContactForm(f => ({ ...f, agentPhone: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Agent WhatsApp</label>
                <input className="form-input" type="tel" placeholder="94771234567 (no +)"
                  value={contactForm.agentWhatsapp}
                  onChange={e => setContactForm(f => ({ ...f, agentWhatsapp: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Customer / Guest Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="form-label">Customer Email</label>
                <input className="form-input" type="email" placeholder="customer@example.com"
                  value={contactForm.contactEmail}
                  onChange={e => setContactForm(f => ({ ...f, contactEmail: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Customer Phone</label>
                <input className="form-input" type="tel" placeholder="+94 77 123 4567"
                  value={contactForm.contactPhone}
                  onChange={e => setContactForm(f => ({ ...f, contactPhone: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Customer WhatsApp</label>
                <input className="form-input" type="tel" placeholder="94771234567 (no +)"
                  value={contactForm.contactWhatsapp}
                  onChange={e => setContactForm(f => ({ ...f, contactWhatsapp: e.target.value }))} />
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Operation Checklist ──────────────────────────────────────────────────────

import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import { getCurrentStep } from '@/lib/state-machine'

interface OpChecklistProps {
  status: BookingStatus
  hasPnl: boolean
  extPnlLinked: boolean
  ticketCount: number
  agendaItems: { assignment?: { id?: string; driverName?: string | null; driverId?: string | null } | null }[]
}

const CHECKLIST: {
  label: string
  key: string
  icon: string
  done: (p: OpChecklistProps) => boolean
  active: (p: OpChecklistProps) => boolean
  link?: string
}[] = [
  {
    label:  'Need Review by TE Team',
    key:    'te-review',
    icon:   '🧑‍✈️',
    done:   p => getCurrentStep(p.status) > 3,
    active: p => p.status === 'GT_REVIEW',
  },
  {
    label:  'Client Verified',
    key:    'gt-verified',
    icon:   '✅',
    done:   p => getCurrentStep(p.status) > 4,
    active: p => p.status === 'GT_VERIFIED',
  },
  {
    label:  'P&L Added',
    key:    'pnl',
    icon:   '📊',
    // Green as soon as an internal P&L exists OR an Accounts (external) PNL is linked.
    done:   p => p.hasPnl || p.extPnlLinked,
    active: p => !(p.hasPnl || p.extPnlLinked) && getCurrentStep(p.status) >= 5,
  },
  {
    label:  'Driver Allocated',
    key:    'driver',
    icon:   '🚗',
    done:   p => getCurrentStep(p.status) >= 10
                 || p.agendaItems.some(item => item.assignment != null && (item.assignment.driverId != null || item.assignment.driverName != null)),
    active: p => {
      const hasDrivers = p.agendaItems.some(item => item.assignment != null && (item.assignment.driverId != null || item.assignment.driverName != null))
      return !hasDrivers && getCurrentStep(p.status) >= 8 && getCurrentStep(p.status) < 10
    },
  },
  {
    label:  'QC1 Pass',
    key:    'qc1',
    icon:   '🛡️',
    done:   p => getCurrentStep(p.status) >= 11,
    active: p => p.status === 'DRIVER_ALLOCATED',
  },
  {
    label:  'Tickets Activated',
    key:    'tickets',
    icon:   '🎫',
    done:   p => getCurrentStep(p.status) >= 12 || p.ticketCount > 0,
    active: p => p.status === 'QC1_PASS',
  },
  {
    label:  'QC2 Pass',
    key:    'qc2',
    icon:   '🔍',
    done:   p => getCurrentStep(p.status) >= 13,
    active: p => p.status === 'TICKETS_ISSUED',
  },
  {
    label:  'Message Sent to Customer',
    key:    'msg',
    icon:   '💬',
    done:   p => getCurrentStep(p.status) >= 14,
    active: p => p.status === 'QC2_PASS',
  },
  {
    label:  'Feedback Done',
    key:    'feedback',
    icon:   '⭐',
    done:   p => getCurrentStep(p.status) >= 15,
    active: p => p.status === 'MSG_SENT_CUSTOMER',
  },
  {
    label:  'Completed',
    key:    'completed',
    icon:   '🏁',
    done:   p => p.status === 'COMPLETED',
    active: p => p.status === 'FEEDBACK_DONE',
  },
]

function OperationChecklist(props: OpChecklistProps) {
  const doneCount = CHECKLIST.filter(c => c.done(props)).length

  return (
    <div className="mt-5 pt-5 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Operation Checklist
        </h4>
        <span className="text-xs font-semibold text-slate-500">
          {doneCount} / {CHECKLIST.length} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-4 overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / CHECKLIST.length) * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {CHECKLIST.map(c => {
          const done   = c.done(props)
          const active = !done && c.active(props)

          return (
            <div
              key={c.key}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                done
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : active
                    ? 'bg-amber-50 border-amber-300 text-amber-700 ring-1 ring-amber-300 ring-offset-1'
                    : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}
            >
              <span className="text-base leading-none flex-shrink-0">{c.icon}</span>
              <span className="leading-tight flex-1 min-w-0">{c.label}</span>
              {done ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              ) : active ? (
                <MinusCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 animate-pulse" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
