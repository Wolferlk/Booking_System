'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Users, Plane, Hotel, MapPin, FileText, CreditCard,
  AlertCircle, Clock, Loader2,
  ChevronRight, Calendar, ArrowLeft, TrendingUp, Ticket,
  Phone, Shield, Edit2, UserCheck,
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
                  : t.to === 'AWAITING_PAYMENT_CONFIRM' ? 'pnl-redirect'
                  : t.from === 'AWAITING_PAYMENT_CONFIRM' && t.to === 'OPERATIONS_READY' ? 'mark-operations-ready'
                  : t.to === 'CLIENT_LIVE' ? 'client-live'
                  : t.to === 'IN_PROGRESS' ? 'in-progress'
                  : t.to === 'COMPLETED' ? 'complete'
                  : ''

                if (!key) return null

                // AC_USER at GT_VERIFIED → redirect to P&L page to upload P&L
                if (key === 'pnl-redirect') {
                  return (
                    <Link key={t.to} href={`/dashboard/bookings/${ref}/pnl`}
                      className="btn btn-primary btn-sm">
                      <TrendingUp className="w-3.5 h-3.5" /> {t.label}
                    </Link>
                  )
                }

                const needsNote = ['change-request', 'resubmit'].includes(key)

                return (
                  <Button
                    key={t.to}
                    variant={t.to === 'CHANGE_REQUESTED' ? 'danger' : 'primary'}
                    size="sm"
                    loading={actionLoading === key}
                    onClick={() => {
                      if (needsNote) { setChangeModal(true) }
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
                <MapPin className="w-3.5 h-3.5" /> Agenda
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
              {['AC_USER', 'SUPER_ADMIN'].includes(role) && (
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
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Plane className="w-4 h-4 text-slate-400" /> Flights
              </h3>
            </CardHeader>
            <CardBody className="p-0">
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

      {/* Change request modal */}
      <Modal
        open={changeModal}
        onClose={() => setChangeModal(false)}
        title={status === 'CHANGE_REQUESTED' ? 'Resubmit with Correction Note' : 'Request Changes from Booking Team'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChangeModal(false)}>Cancel</Button>
            <Button
              loading={!!actionLoading}
              onClick={() => {
                const endpoint = status === 'CHANGE_REQUESTED' ? 'resubmit' : 'change-request'
                doTransition(endpoint, { notes: note, note }).then(() => { setChangeModal(false); setNote('') })
              }}
            >
              {status === 'CHANGE_REQUESTED' ? 'Resubmit' : 'Send Request'}
            </Button>
          </>
        }
      >
        <div>
          <label className="form-label">
            {status === 'CHANGE_REQUESTED' ? 'Correction note (what was fixed)' : 'What needs to be changed?'}
          </label>
          <textarea
            className="form-textarea"
            rows={4}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Describe the change required..."
          />
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
    </div>
  )
}
