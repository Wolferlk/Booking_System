'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Globe, Calendar, Users, Plane, Hotel, MapPin, CreditCard,
  Phone, Car, MessageCircle, Loader2, ChevronRight, Clock,
  CheckCircle2, AlertCircle, Lock,
} from 'lucide-react'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { BookingStatus } from '@prisma/client'

interface PortalData {
  bookingRef: string
  status: BookingStatus
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  agent: string | null
  passengers: { id: string; name: string; type: string; isLead: boolean }[]
  flights: { id: string; flightNo: string; date: string; fromApt: string; depTime: string; toApt: string; arrTime: string }[]
  accommodations: { id: string; city: string; hotel: string; checkIn: string; checkOut: string; nights: number; roomType?: string }[]
  agenda: {
    items: {
      id: string; date: string; location: string; fromPoint?: string; toPoint?: string
      details?: string; mealPlan?: string; meetingTime?: string; serviceType: string
      assignment?: { driverName?: string; driverPhone?: string; vehicleType?: string; vehiclePlate?: string } | null
    }[]
  } | null
  payments: { id: string; type: string; amount: string; currency: string; status: string; method?: string; paidAt?: string }[]
}

export default function ClientPortalPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'trip' | 'payments' | 'contact'>('trip')
  const [requestModal, setRequestModal] = useState(false)
  const [requestNote, setRequestNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/portal/${ref}`)
      .then(r => r.json())
      .then(j => {
        if (j.success) setData(j.data)
        else setError(j.error ?? 'Unable to load trip')
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false))
  }, [ref])

  async function submitRequest() {
    if (!requestNote.trim()) { toast.error('Please describe your request'); return }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/portal/${ref}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: requestNote }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Your request has been sent to our team!')
      setRequestModal(false)
      setRequestNote('')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
        <Lock className="w-8 h-8 text-red-400" />
      </div>
      <h2 className="text-white font-bold text-xl mb-2">Portal Unavailable</h2>
      <p className="text-slate-400 text-sm max-w-sm">
        {error ?? 'Your trip portal will be available 5 days before departure.'}
      </p>
    </div>
  )

  const TABS = [
    { key: 'trip', label: 'My Trip', icon: Globe },
    { key: 'payments', label: 'Payments', icon: CreditCard },
    { key: 'contact', label: 'Contacts', icon: Phone },
  ]

  const totalPaid = data.payments.filter(p => p.status === 'COMPLETE').reduce((s, p) => s + Number(p.amount), 0)

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center">
                  <span className="font-bold text-white text-sm">AH</span>
                </div>
                <div>
                  <p className="text-white font-bold">AppleHolidays</p>
                  <p className="text-slate-400 text-xs">Your Trip Portal</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <span className="text-2xl font-bold font-mono">{data.bookingRef}</span>
                <StatusBadge status={data.status} />
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {formatDate(data.arrivalDate)} → {formatDate(data.departureDate)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {data.paxAdults} adults{data.paxChildren > 0 ? `, ${data.paxChildren} children` : ''}
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              icon={<MessageCircle className="w-4 h-4" />}
              onClick={() => setRequestModal(true)}
              className="flex-shrink-0"
            >
              Request Update
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mt-6">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${
                  activeTab === tab.key
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* TRIP TAB */}
        {activeTab === 'trip' && (
          <>
            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Arrival', value: formatDate(data.arrivalDate, 'dd MMM') },
                { label: 'Nights', value: data.accommodations.reduce((s, a) => s + a.nights, 0) },
                { label: 'Cities', value: [...new Set(data.accommodations.map(a => a.city))].length },
              ].map(s => (
                <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <p className="text-slate-400 text-xs">{s.label}</p>
                  <p className="text-white font-bold text-xl mt-1">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Passengers */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10">
                <Users className="w-4 h-4 text-brand-400" />
                <span className="text-sm font-semibold">Travellers</span>
              </div>
              <div className="divide-y divide-white/5">
                {data.passengers.map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-300 text-xs font-bold">
                      {p.name.slice(0, 1)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{p.name}
                        {p.isLead && <span className="ml-2 text-[10px] bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full">Lead</span>}
                      </p>
                      <p className="text-xs text-slate-400">{p.type}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Flights */}
            {data.flights.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10">
                  <Plane className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold">Flights</span>
                </div>
                {data.flights.map(f => (
                  <div key={f.id} className="flex items-center justify-between px-5 py-3 border-b border-white/5 last:border-0">
                    <div>
                      <span className="font-semibold font-mono text-brand-300">{f.flightNo}</span>
                      <span className="text-slate-400 text-xs ml-3">{formatDate(f.date)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{f.fromApt}</span>
                      <span className="text-slate-500 text-xs">{f.depTime}</span>
                      <ChevronRight className="w-3 h-3 text-slate-500" />
                      <span className="font-medium">{f.toApt}</span>
                      <span className="text-slate-500 text-xs">{f.arrTime}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Accommodation */}
            {data.accommodations.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10">
                  <Hotel className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold">Accommodation</span>
                </div>
                {data.accommodations.map(a => (
                  <div key={a.id} className="px-5 py-3 border-b border-white/5 last:border-0">
                    <p className="text-sm font-semibold">{a.hotel}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {a.city} · {a.nights} nights · {formatDate(a.checkIn)} → {formatDate(a.checkOut)}
                    </p>
                    {a.roomType && <p className="text-xs text-slate-500">{a.roomType}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Agenda */}
            {data.agenda && data.agenda.items.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10">
                  <MapPin className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold">Day-by-Day Itinerary</span>
                </div>
                <div className="divide-y divide-white/5">
                  {data.agenda.items.map((item, i) => (
                    <div key={item.id} className="px-5 py-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center">
                            <span className="text-brand-300 text-xs font-bold">{i + 1}</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold">{item.location}</span>
                            <span className="text-slate-400 text-xs">{formatDate(item.date)}</span>
                            {item.mealPlan && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                                {item.mealPlan}
                              </span>
                            )}
                          </div>
                          {item.toPoint && (
                            <p className="text-sm text-slate-300 mt-0.5">
                              {item.fromPoint && <span className="text-slate-500">{item.fromPoint} → </span>}
                              {item.toPoint}
                            </p>
                          )}
                          {item.details && <p className="text-xs text-slate-400 mt-1">{item.details}</p>}
                          {item.meetingTime && (
                            <p className="text-xs text-brand-400 mt-1 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Meet at {item.meetingTime}
                            </p>
                          )}

                          {/* Driver info */}
                          {item.assignment?.driverName && (
                            <div className="mt-2 flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                              <Car className="w-4 h-4 text-blue-400 flex-shrink-0" />
                              <div>
                                <p className="text-xs font-semibold text-blue-300">{item.assignment.driverName}</p>
                                <p className="text-xs text-slate-400">
                                  {item.assignment.vehicleType} {item.assignment.vehiclePlate}
                                  {item.assignment.driverPhone && ` · ${item.assignment.driverPhone}`}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* PAYMENTS TAB */}
        {activeTab === 'payments' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 text-center">
                <p className="text-slate-400 text-xs">Total Paid</p>
                <p className="text-2xl font-bold text-green-400 mt-1">{formatCurrency(totalPaid)}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 text-center">
                <p className="text-slate-400 text-xs">Transactions</p>
                <p className="text-2xl font-bold mt-1">{data.payments.length}</p>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/10">
                <p className="text-sm font-semibold">Payment History</p>
              </div>
              {data.payments.length === 0 ? (
                <div className="text-center py-10 text-slate-500">
                  <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No payments recorded</p>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {data.payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium capitalize">{p.type.replace('_', ' ')}</p>
                        {p.paidAt && <p className="text-xs text-slate-400">{formatDate(p.paidAt)}</p>}
                        {p.method && <p className="text-xs text-slate-500">{p.method}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatCurrency(p.amount, p.currency)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          p.status === 'COMPLETE' ? 'bg-green-500/20 text-green-400' :
                          p.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* CONTACT TAB */}
        {activeTab === 'contact' && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center">
                  <Phone className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Travel Experience Team</p>
                  <p className="text-xs text-slate-400">Your point of contact for queries</p>
                </div>
              </div>
              <p className="text-slate-300 text-sm">
                Our Travel Experience team is here to help. For urgent matters during your trip, use the contact below.
              </p>
              <div className="mt-4 flex gap-3">
                <Button variant="outline" size="sm" icon={<MessageCircle className="w-4 h-4" />}
                  onClick={() => setRequestModal(true)}>
                  Send Message
                </Button>
              </div>
            </div>

            {/* Driver contacts from agenda */}
            {data.agenda?.items.filter(i => i.assignment?.driverName).map(item => (
              <div key={item.id} className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Car className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="text-sm font-semibold">{item.assignment!.driverName}</p>
                    <p className="text-xs text-slate-400">{formatDate(item.date)} · {item.location}</p>
                  </div>
                </div>
                <div className="text-xs text-slate-300 space-y-1">
                  {item.assignment!.vehicleType && <p>Vehicle: {item.assignment!.vehicleType} {item.assignment!.vehiclePlate}</p>}
                  {item.assignment!.driverPhone && (
                    <a href={`tel:${item.assignment!.driverPhone}`} className="flex items-center gap-1 text-brand-400 hover:text-brand-300">
                      <Phone className="w-3 h-3" /> {item.assignment!.driverPhone}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Request update modal */}
      <Modal
        open={requestModal}
        onClose={() => setRequestModal(false)}
        title="Request an Update"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRequestModal(false)}>Cancel</Button>
            <Button loading={submitting} onClick={submitRequest}>Send Request</Button>
          </>
        }
      >
        <div>
          <p className="text-sm text-slate-500 mb-4">
            Describe what you need and our team will get back to you shortly.
          </p>
          <label className="form-label">Your request *</label>
          <textarea
            className="form-textarea"
            rows={4}
            value={requestNote}
            onChange={e => setRequestNote(e.target.value)}
            placeholder="e.g. Can we change the airport pickup time to 10:00 AM?"
          />
        </div>
      </Modal>
    </div>
  )
}
