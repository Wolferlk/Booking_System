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
  FlaskConical,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import BookingLifecycle from '@/components/bookings/booking-lifecycle'
import Modal from '@/components/ui/modal'
import { formatDate, formatCurrency, getDaysUntilTrip } from '@/lib/utils'
import { getAvailableTransitions } from '@/lib/state-machine'
import type { UserRole, BookingStatus } from '@prisma/client'
import Link from 'next/link'
import WhatsAppMiniChat from '@/components/bookings/whatsapp-mini-chat'
import BookingQCPanel from '@/components/bookings/booking-qc-panel'
import OneDriveFiles from '@/components/bookings/onedrive-files'

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
  const [savingAccom, setSavingAccom] = useState(false)
  const [editBookingModal, setEditBookingModal] = useState(false)
  const [bookingForm, setBookingForm] = useState({
    agent: '', fileHandler: '', agentBookingId: '',
    arrivalDate: '', departureDate: '',
    paxAdults: '2', paxChildren: '0',
    quotedTotal: '', currency: 'USD',
    terms: '', exclusions: '', policyNotes: '', amendmentNote: '',
  })
  const [savingBooking, setSavingBooking] = useState(false)

  type FlightEntry = {
    _key: string; _isNew: boolean; _deleted: boolean
    id: string; flightNo: string; date: string
    fromApt: string; depTime: string; toApt: string; arrTime: string
    airline: string; notes: string
  }
  const [editFlightModal, setEditFlightModal] = useState(false)
  const [flightEditList, setFlightEditList] = useState<FlightEntry[]>([])
  const [flightChangeReason, setFlightChangeReason] = useState('')
  const [savingFlights, setSavingFlights] = useState(false)

  const [waModal, setWaModal] = useState(false)
  const [waPhone, setWaPhone] = useState('')
  const [waMessage, setWaMessage] = useState('')
  const [waAttachPdf, setWaAttachPdf] = useState(true)
  const [waSending, setWaSending] = useState(false)
  const [waPdfType, setWaPdfType] = useState<'confirmation' | 'full'>('confirmation')

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

  // Meal preference inline editing
  const [mealPrefs, setMealPrefs] = useState<Record<string, string>>({})
  const [mealPrefsDirty, setMealPrefsDirty] = useState(false)
  const [savingMealPrefs, setSavingMealPrefs] = useState(false)
  const [expandedMeal, setExpandedMeal] = useState<Set<string>>(new Set())

  // Customer feedback modal (triggered on Complete Trip)
  const [feedbackModal, setFeedbackModal] = useState(false)
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackComment, setFeedbackComment] = useState('')
  const [feedbackSaving, setFeedbackSaving] = useState(false)

  // Contact info editing
  const [editContactModal, setEditContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ agentEmail: '', agentPhone: '', agentWhatsapp: '', agentAddress: '', contactEmail: '', contactPhone: '', contactWhatsapp: '', contactAddress: '' })
  const [savingContact, setSavingContact] = useState(false)

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

  useEffect(() => { load() }, [ref])

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

  function openEditBooking() {
    setBookingForm({
      agent: String(booking.agent ?? ''),
      fileHandler: String(booking.fileHandler ?? ''),
      agentBookingId: String(booking.agentBookingId ?? ''),
      arrivalDate: booking.arrivalDate ? String(booking.arrivalDate).slice(0, 10) : '',
      departureDate: booking.departureDate ? String(booking.departureDate).slice(0, 10) : '',
      paxAdults: String(booking.paxAdults ?? 2),
      paxChildren: String(booking.paxChildren ?? 0),
      quotedTotal: String(booking.quotedTotal ?? ''),
      currency: String(booking.currency ?? 'USD'),
      terms: String(booking.terms ?? ''),
      exclusions: String(booking.exclusions ?? ''),
      policyNotes: String(booking.policyNotes ?? ''),
      amendmentNote: String(booking.amendmentNote ?? ''),
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
      const accommodationUpdates = Object.entries(accomEdits).map(([id, fields]) => ({ id, ...fields }))
      const res = await fetch(`/api/bookings/${ref}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accommodationUpdates }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Accommodation updated')
      setEditAccomModal(false)
      setAccomEdits({})
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSavingAccom(false) }
  }

  function buildConfirmationMessage(firstName: string): string {
    return `Hello ${firstName},
Greetings from Apple Holidays! 🌟

Please find the attached *Tour Confirmation* for your upcoming trip.

*Booking Reference:* ${ref}
*Travel Dates:* ${booking.arrivalDate ? new Date(booking.arrivalDate as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} – ${booking.departureDate ? new Date(booking.departureDate as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
*Passengers:* ${booking.paxAdults ?? 0} Adults${(booking.paxChildren as number) > 0 ? `, ${booking.paxChildren} Children` : ''}

Kindly review the attached PDF and confirm:
✅ All passenger names & passport details are correct
✅ Accommodation and itinerary are as expected
✅ Flight details (if any) are accurate

We kindly request the following information:
1️⃣ Meal preference — Vegetarian or Non-Vegetarian?
2️⃣ Any special assistance required for seniors or infants?

*Emergency Contacts:*
📞 Helen: +84 94 959 15 36
📞 Senthoor Pandian: +91 95852 22335
📞 Tina: +84 94 516 95 95

Please reply with your confirmation at the earliest.
Thank you! 🙏
*Apple Holidays Team*`
  }

  function buildFullDetailsMessage(firstName: string): string {
    return `Hello ${firstName},
Greetings from Apple Holidays! 🌟

Please find the *Full Tour Details & Vouchers* for your upcoming trip to Vietnam.

*Booking Reference:* ${ref}
*Travel Dates:* ${booking.arrivalDate ? new Date(booking.arrivalDate as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} – ${booking.departureDate ? new Date(booking.departureDate as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}

This document includes:
✅ Complete day-by-day itinerary & tour agenda
✅ Driver & vehicle assignments
✅ All tickets and voucher receipts

Please keep this document handy throughout your travel.

*Emergency Contacts:*
📞 Helen: +84 94 959 15 36
📞 Senthoor Pandian: +91 95852 22335
📞 Tina: +84 94 516 95 95

Wishing you a wonderful trip! ✈️
*Apple Holidays Team*`
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
      toast.success('Trip completed and feedback saved')
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
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(`WhatsApp ${waPdfType === 'full' ? 'Full Details' : 'Confirmation'} sent!`)
      setWaModal(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally { setWaSending(false) }
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

      <div className="p-8 space-y-6 ">

        {/* Lifecycle + status */}
        <Card className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="text-2xl font-bold font-mono text-slate-900">{booking.bookingRef as string}</span>
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
                    booking.operationCountry === 'SINGAPORE_MALAYSIA' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                    'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    {booking.operationCountry === 'VIETNAM'            ? '🇻🇳 Vietnam' :
                     booking.operationCountry === 'SRILANKA'           ? '🇱🇰 Sri Lanka' :
                     booking.operationCountry === 'SINGAPORE_MALAYSIA' ? '🇸🇬🇲🇾 Singapore & Malaysia' :
                     '🌐 All Countries'}
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
                  {booking.paxAdults as number} adults, {booking.paxChildren as number} children
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
                const ADVANCE_STEPS: BookingStatus[] = [
                  'TE_REVIEWED', 'DRIVER_ALLOCATED', 'QC1_PASS',
                  'TICKETS_ISSUED', 'QC2_PASS', 'MSG_SENT_CUSTOMER', 'FEEDBACK_DONE',
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
                      if (needsNote) {
                        setPendingAction(key); setNote(''); setChangeModal(true)
                      } else if (isTeConfirm) {
                        doTransition('verify')
                      } else if (isAdvanceStep) {
                        doTransition('advance-status', { to: t.to })
                      } else if (isComplete) {
                        setFeedbackRating(0)
                        setFeedbackComment('')
                        setFeedbackModal(true)
                      } else {
                        doTransition(key)
                      }
                    }}
                  >
                    {isTeConfirm ? '✓ TE Confirm' : t.label}
                  </Button>
                )
              })}

              {/* Cancel */}
              {!['COMPLETED', 'CANCELLED'].includes(status) && ['BT_USER', 'SUPER_ADMIN', 'TE_USER'].includes(role) && (
                <Button variant="danger" size="sm" onClick={() => setCancelModal(true)}>
                  Cancel Booking
                </Button>
              )}

              {/* OneDrive folder link */}
              {booking.onedriveFolderUrl && (
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
              {['TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <button
                  onClick={openWhatsApp}
                  className="btn btn-sm bg-green-600 text-white border border-green-700 hover:bg-green-700 flex items-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </button>
              )}
              {['TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
                <button
                  onClick={openEmailModal}
                  className="btn btn-sm bg-blue-600 text-white border border-blue-700 hover:bg-blue-700 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Send Email
                </button>
              )}
              {role === 'SUPER_ADMIN' && !['COMPLETED'].includes(status) && (
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

          {/* Lifecycle */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <BookingLifecycle status={status} />
          </div>

          {/* Operation Checklist */}
          <OperationChecklist
            status={status}
            hasPnl={!!(pnl && (booking.pnl as any)?.lineItems?.length > 0)}
            ticketCount={(booking.tickets as any[])?.length ?? 0}
            agendaItems={(booking.tourAgenda as any)?.items ?? []}
          />
        </Card>

        {/* TC Confirmation Details — always shown */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-brand-400" />
            <h3 className="text-sm font-semibold text-slate-900">Tour Confirmation Details</h3>
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
                  booking.operationCountry === 'SINGAPORE_MALAYSIA' ? 'bg-blue-500/10 text-blue-500 border-blue-500/25' :
                  'bg-slate-100 text-slate-400 border-slate-200'
                }`}
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%239ca3af\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
              >
                <option value="">🌍 Country not set</option>
                <option value="VIETNAM">🇻🇳 Vietnam</option>
                <option value="SRILANKA">🇱🇰 Sri Lanka</option>
                <option value="SINGAPORE_MALAYSIA">🇸🇬🇲🇾 Singapore &amp; Malaysia</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Tour Ref</p>
              <p className="text-sm font-mono font-semibold text-slate-900">{booking.bookingRef as string}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">IS Number</p>
              {booking.isNumber
                ? <p className="text-sm font-mono font-semibold text-brand-600">{booking.isNumber as string}</p>
                : <p className="text-sm text-slate-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Reference Number</p>
              {booking.agentBookingId
                ? <p className="text-sm font-mono text-slate-700">{booking.agentBookingId as string}</p>
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
        </Card>

        {/* QC Panel — visible to operations/TE/admin */}
        {['GT_USER', 'TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
          <BookingQCPanel
            booking={booking}
            onAutoSend={handleQCAutoSend}
            autoSending={qcAutoSending}
            daysUntilTrip={daysUntil}
          />
        )}

        {/* OneDrive Files — show to all internal staff */}
        {['GT_USER', 'TE_USER', 'GT_TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) && (
          <OneDriveFiles
            bookingRef={ref}
            canSync={['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)}
          />
        )}

        {/* Open change requests */}
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
                mealPrefsDirty && canEditBooking ? (
                  <button
                    onClick={saveMealPreferences}
                    disabled={savingMealPrefs}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {savingMealPrefs
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                      : <><Save className="w-3 h-3" /> Save Meal Prefs</>}
                  </button>
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
                <button onClick={openEditFlight} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                  <Edit2 className="w-3 h-3" /> Edit
                </button>
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
                <button onClick={() => {
                  const edits: Record<string, unknown> = {}
                  accommodations.forEach((a) => { edits[a.id] = { hotel: a.hotel, roomType: a.roomType ?? '', address: a.address ?? '', contact: a.contact ?? '' } })
                  setAccomEdits(edits)
                  setEditAccomModal(true)
                }} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                  <Edit2 className="w-3 h-3" /> Edit
                </button>
              ) : undefined}
            >
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Hotel className="w-4 h-4 text-slate-400" /> Accommodation
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              {accommodations.map((a) => (
                <div key={a.id as string} className="px-4 py-3 border-b border-slate-100 last:border-0">
                  <p className="text-sm font-semibold text-slate-900">{a.hotel as string}</p>
                  <p className="text-xs text-slate-500">{a.city as string} · {a.nights as number} nights</p>
                  {a.roomType && <p className="text-xs text-brand-600 font-medium">{a.roomType as string}</p>}
                  <p className="text-xs text-slate-400">{formatDate(a.checkIn as string)} → {formatDate(a.checkOut as string)}</p>
                  {a.contact && <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{a.contact as string}</p>}
                </div>
              ))}
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
        onClose={() => setEditAccomModal(false)}
        title="Edit Accommodation Details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditAccomModal(false)}>Cancel</Button>
            <Button loading={savingAccom} onClick={saveAccomEdits}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-5">
          <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            Use this for critical room or hotel changes only. P&L is not automatically updated.
          </p>
          {accommodations.map((a) => (
            <div key={a.id as string} className="border border-slate-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {a.city as string} · {formatDate(a.checkIn as string)} – {formatDate(a.checkOut as string)}
              </p>
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
        </div>
      </Modal>

      {/* Cancel modal */}
      <Modal
        open={cancelModal}
        onClose={() => setCancelModal(false)}
        title="Cancel Booking"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelModal(false)}>Keep Booking</Button>
            <Button
              variant="danger"
              loading={actionLoading === 'cancel'}
              onClick={() => {
                if (!cancelReason) { toast.error('Please provide a reason'); return }
                doTransition('cancel', { reason: cancelReason }).then(() => { setCancelModal(false); setCancelReason('') })
              }}
            >
              Confirm Cancellation
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {daysUntil <= 21 && daysUntil > 0 && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium">
                Warning: 100% cancellation penalty applies (within 21-day window)
              </p>
            </div>
          )}
          <div>
            <label className="form-label">Cancellation Reason *</label>
            <textarea className="form-textarea" rows={3}
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation..." />
          </div>
        </div>
      </Modal>

      {/* ── Customer Feedback Modal (Complete Trip) ─────────────────── */}
      <Modal
        open={feedbackModal}
        onClose={() => setFeedbackModal(false)}
        title="Customer Feedback — Complete Trip"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFeedbackModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={feedbackSaving}
              onClick={saveFeedbackAndComplete}
            >
              Save &amp; Complete Trip
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              Record the customer&apos;s feedback before completing the trip. This will be saved by the TE team.
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
    done:   p => p.hasPnl,
    active: p => !p.hasPnl && getCurrentStep(p.status) >= 5,
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
