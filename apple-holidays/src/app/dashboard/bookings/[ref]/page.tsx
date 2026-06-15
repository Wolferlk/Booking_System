'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Users, Plane, Hotel, MapPin, FileText, CreditCard,
  AlertCircle, Clock, Loader2,
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
  const canViewClientDetails = ['BT_USER', 'GT_USER', 'TE_USER', 'SUPER_ADMIN'].includes(role)
  const canEditBooking = ['GT_USER', 'BT_USER', 'TE_USER', 'AC_USER', 'SUPER_ADMIN'].includes(role)

  const canEditFlights = ['TE_USER', 'BT_USER', 'SUPER_ADMIN'].includes(role)

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

  async function openWhatsApp() {
    const { mode, settings } = await loadTestMode()
    const lead = (booking.passengers ?? []).find((p: { isLead: boolean; name: string }) => p.isLead) ?? (booking.passengers ?? [])[0]
    const firstName = (lead?.name ?? 'Guest').split(' ')[0]
    const storedPhone = booking.contactWhatsapp ?? booking.contactPhone ?? booking.agentWhatsapp ?? booking.agentPhone ?? ''
    setWaPhone(mode ? settings.testWhatsapp : storedPhone)
    setWaPdfType('confirmation')
    setWaMessage(buildConfirmationMessage(firstName))
    setWaAttachPdf(true)
    setWaModal(true)
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

      <div className="p-8 space-y-6 max-w-7xl">

        {/* Lifecycle + status */}
        <Card className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl font-bold font-mono text-slate-900">{booking.bookingRef as string}</span>
                <StatusBadge status={status} />
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
                const key = t.to === 'CHANGE_REQUESTED' ? 'change-request'
                  : t.from === 'CHANGE_REQUESTED' && t.to === 'BT_CONFIRMED' ? 'resubmit'
                  : t.to === 'GT_REVIEW' ? 'submit-ground'
                  : t.to === 'BT_CONFIRMED' ? 'confirm'
                  : t.to === 'GT_VERIFIED' ? 'verify'
                  : t.to === 'OPERATIONS_READY' ? 'mark-operations-ready'
                  : t.to === 'CLIENT_LIVE' ? 'client-live'
                  : t.to === 'IN_PROGRESS' ? 'in-progress'
                  : t.to === 'COMPLETED' ? 'complete'
                  : ''

                if (!key) return null

                // Keys that open the note modal before calling their endpoint
                const needsNote = ['change-request', 'resubmit', 'verify'].includes(key)

                return (
                  <Button
                    key={t.to}
                    variant={t.to === 'CHANGE_REQUESTED' ? 'danger' : 'primary'}
                    size="sm"
                    loading={actionLoading === key}
                    onClick={() => {
                      if (needsNote) { setPendingAction(key); setNote(''); setChangeModal(true) }
                      else doTransition(key)
                    }}
                  >
                    {t.label}
                  </Button>
                )
              })}

              {/* Cancel */}
              {!['COMPLETED', 'CANCELLED'].includes(status) && ['BT_USER', 'SUPER_ADMIN', 'TE_USER'].includes(role) && (
                <Button variant="danger" size="sm" onClick={() => setCancelModal(true)}>
                  Cancel Booking
                </Button>
              )}

              {/* Links to sub-pages */}
              <Link href={`/dashboard/bookings/${ref}/agenda`} className="btn btn-secondary btn-sm">
                <MapPin className="w-3.5 h-3.5" /> Movement Chart
              </Link>
              <Link href={`/dashboard/bookings/${ref}/tickets`} className="btn btn-secondary btn-sm">
                <Ticket className="w-3.5 h-3.5" /> Tickets
              </Link>
              {/* Drivers — GT can assign drivers from the Agenda page */}
              {['GT_USER', 'SUPER_ADMIN'].includes(role) && (
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
              {['BT_USER', 'AC_USER', 'TE_USER', 'SUPER_ADMIN'].includes(role) && (
                <Link href={`/dashboard/bookings/${ref}/pnl`} className="btn btn-secondary btn-sm">
                  <TrendingUp className="w-3.5 h-3.5" /> P&amp;L
                </Link>
              )}
              {canEditBooking && (
                <button onClick={openEditBooking} className="btn btn-secondary btn-sm">
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
              )}
              {['BT_USER', 'GT_USER', 'TE_USER', 'SUPER_ADMIN'].includes(role) && (
                <Link href={`/print/booking/${ref}`} target="_blank" className="btn btn-secondary btn-sm">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </Link>
              )}
              {['TE_USER', 'BT_USER', 'SUPER_ADMIN'].includes(role) && (
                <button
                  onClick={openWhatsApp}
                  className="btn btn-sm bg-green-600 text-white border border-green-700 hover:bg-green-700 flex items-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </button>
              )}
              {['TE_USER', 'SUPER_ADMIN'].includes(role) && (
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
        </Card>

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

          {/* Passengers */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" /> Passengers
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              {passengers.map((p) => (
                <div key={p.id as string} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0">
                    {(p.name as string).slice(0, 1)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {p.name as string}
                      {p.isLead && <span className="ml-2 text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full">Lead</span>}
                    </p>
                    <p className="text-xs text-slate-500">{p.type as string} · {p.age ? `Age ${p.age}` : 'Age N/A'}</p>
                  </div>
                </div>
              ))}
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
          booking.agentEmail || booking.agentPhone || booking.agentWhatsapp ||
          booking.contactEmail || booking.contactPhone || booking.contactWhatsapp
        ) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Agent Contact */}
            {(booking.agentEmail || booking.agentPhone || booking.agentWhatsapp) && (
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-slate-400" /> Agent Contact
                    {booking.agent && <span className="text-xs text-slate-400 font-normal">— {booking.agent as string}</span>}
                  </h3>
                </CardHeader>
                <CardBody className="py-3 px-4">
                  <div className="space-y-2.5">
                    {booking.agentEmail && (
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-slate-300 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400">Email</p>
                          <a href={`mailto:${booking.agentEmail as string}`} className="text-sm text-brand-600 hover:underline truncate block">{booking.agentEmail as string}</a>
                        </div>
                        <button
                          onClick={() => { navigator.clipboard.writeText(booking.agentEmail as string); toast.success('Email copied') }}
                          className="text-slate-300 hover:text-slate-500 flex-shrink-0"
                        ><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                    {booking.agentPhone && (
                      <div className="flex items-center gap-3">
                        <Phone className="w-4 h-4 text-slate-300 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400">Phone</p>
                          <a href={`tel:${booking.agentPhone as string}`} className="text-sm text-slate-700 hover:underline">{booking.agentPhone as string}</a>
                        </div>
                        <button
                          onClick={() => { navigator.clipboard.writeText(booking.agentPhone as string); toast.success('Phone copied') }}
                          className="text-slate-300 hover:text-slate-500 flex-shrink-0"
                        ><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                    {booking.agentWhatsapp && (
                      <div className="flex items-center gap-3">
                        <MessageCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400">WhatsApp</p>
                          <span className="text-sm text-slate-700">{booking.agentWhatsapp as string}</span>
                        </div>
                        <button
                          onClick={() => { navigator.clipboard.writeText(booking.agentWhatsapp as string); toast.success('WhatsApp number copied') }}
                          className="text-slate-300 hover:text-slate-500 flex-shrink-0"
                        ><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Tourist / Guest Contact */}
            {(booking.contactEmail || booking.contactPhone || booking.contactWhatsapp) && (
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-brand-400" /> Guest / Tourist Contact
                    {booking.contactCountry && <span className="text-xs text-slate-400 font-normal">— {booking.contactCountry as string}</span>}
                  </h3>
                </CardHeader>
                <CardBody className="py-3 px-4">
                  <div className="space-y-2.5">
                    {booking.contactEmail && (
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-slate-300 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400">Email</p>
                          <a href={`mailto:${booking.contactEmail as string}`} className="text-sm text-brand-600 hover:underline truncate block">{booking.contactEmail as string}</a>
                        </div>
                        <button
                          onClick={() => { navigator.clipboard.writeText(booking.contactEmail as string); toast.success('Email copied') }}
                          className="text-slate-300 hover:text-slate-500 flex-shrink-0"
                        ><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                    {booking.contactPhone && (
                      <div className="flex items-center gap-3">
                        <Phone className="w-4 h-4 text-slate-300 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400">Phone</p>
                          <a href={`tel:${booking.contactPhone as string}`} className="text-sm text-slate-700 hover:underline">{booking.contactPhone as string}</a>
                        </div>
                        <button
                          onClick={() => { navigator.clipboard.writeText(booking.contactPhone as string); toast.success('Phone copied') }}
                          className="text-slate-300 hover:text-slate-500 flex-shrink-0"
                        ><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                    {booking.contactWhatsapp && (
                      <div className="flex items-center gap-3">
                        <MessageCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400">WhatsApp</p>
                          <span className="text-sm text-slate-700">{booking.contactWhatsapp as string}</span>
                        </div>
                        <button
                          onClick={() => { navigator.clipboard.writeText(booking.contactWhatsapp as string); toast.success('WhatsApp number copied') }}
                          className="text-slate-300 hover:text-slate-500 flex-shrink-0"
                        ><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
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
                  Send 1
                </span>
                <span className="text-sm font-semibold text-slate-800">Tour Confirmation</span>
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
                  Send 2
                </span>
                <span className="text-sm font-semibold text-slate-800">Full Details + Vouchers</span>
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

          {/* Extracted numbers from booking */}
          {!testMode && (booking.contactWhatsapp || booking.contactPhone || booking.agentWhatsapp || booking.agentPhone) && (
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-500 space-y-1">
              <p className="font-medium text-slate-600">Extracted numbers from booking:</p>
              {booking.contactWhatsapp && <p>Customer WhatsApp: <button className="text-brand-600 hover:underline" onClick={() => setWaPhone(booking.contactWhatsapp as string)}>{booking.contactWhatsapp as string}</button></p>}
              {booking.contactPhone    && <p>Customer Phone: <button className="text-brand-600 hover:underline" onClick={() => setWaPhone(booking.contactPhone as string)}>{booking.contactPhone as string}</button></p>}
              {booking.agentWhatsapp   && <p>Agent WhatsApp: <button className="text-brand-600 hover:underline" onClick={() => setWaPhone(booking.agentWhatsapp as string)}>{booking.agentWhatsapp as string}</button></p>}
              {booking.agentPhone      && <p>Agent Phone: <button className="text-brand-600 hover:underline" onClick={() => setWaPhone(booking.agentPhone as string)}>{booking.agentPhone as string}</button></p>}
            </div>
          )}

          {/* Phone */}
          <div>
            <label className="form-label">Client WhatsApp / Phone Number *</label>
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
      {['TE_USER', 'BT_USER', 'SUPER_ADMIN'].includes(role) && (
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
    </div>
  )
}
