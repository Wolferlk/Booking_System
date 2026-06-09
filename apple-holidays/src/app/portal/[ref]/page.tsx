'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Globe, Calendar, Users, Plane, Hotel, MapPin, CreditCard,
  Phone, Car, MessageCircle, Loader2, ChevronRight, Clock,
  CheckCircle2, AlertCircle, Lock, ArrowLeft, Star,
  Send, Home,
} from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { BookingStatus } from '@prisma/client'
import { differenceInDays, format } from 'date-fns'

interface PortalData {
  bookingRef: string
  status: BookingStatus
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  agent: string | null
  passengers: { id: string; name: string; type: string; isLead: boolean }[]
  flights: {
    id: string; flightNo: string; date: string; airline?: string
    fromApt: string; depTime: string; toApt: string; arrTime: string
  }[]
  accommodations: {
    id: string; city: string; hotel: string; checkIn: string; checkOut: string; nights: number
    roomType?: string; address?: string; contact?: string
  }[]
  agenda: {
    items: {
      id: string; date: string; location: string; fromPoint?: string; toPoint?: string
      details?: string; mealPlan?: string; meetingTime?: string; serviceType: string
      assignment?: { driverName?: string; driverPhone?: string; vehicleType?: string; vehiclePlate?: string } | null
    }[]
  } | null
  payments: {
    id: string; type: string; label?: string; amount: string; currency: string
    status: string; method?: string; paidAt?: string; refNumber?: string
  }[]
}

type Tab = 'trip' | 'itinerary' | 'payments' | 'contact'

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  PENDING: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  REJECTED: 'bg-red-500/15 text-red-400 border-red-500/20',
}

export default function ClientPortalPage() {
  const { ref } = useParams<{ ref: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('trip')
  const [requestModal, setRequestModal] = useState(false)
  const [requestNote, setRequestNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/portal/${ref}`)
      .then(r => r.json())
      .then(j => { if (j.success) setData(j.data); else setError(j.error ?? 'Unable to load trip') })
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
      toast.success('Your request has been sent!')
      setRequestModal(false); setRequestNote('')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally { setSubmitting(false) }
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-brand-500 animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Loading your trip…</p>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-5">
        <Lock className="w-10 h-10 text-red-400" />
      </div>
      <h2 className="text-white font-bold text-2xl mb-2">Portal Unavailable</h2>
      <p className="text-slate-400 max-w-sm">
        {error ?? 'Your trip portal will be unlocked 5 days before your arrival date.'}
      </p>
      <button onClick={() => router.push('/portal')} className="mt-6 flex items-center gap-2 text-brand-400 hover:text-brand-300 text-sm">
        <ArrowLeft className="w-4 h-4" /> Back to My Trips
      </button>
    </div>
  )

  const daysUntil = differenceInDays(new Date(data.arrivalDate), new Date())
  const totalNights = data.accommodations.reduce((s, a) => s + a.nights, 0)
  const cities = Array.from(new Set(data.accommodations.map(a => a.city)))
  const totalPaid = data.payments.filter(p => p.status === 'CONFIRMED').reduce((s, p) => s + Number(p.amount), 0)
  const pendingPayments = data.payments.filter(p => p.status === 'PENDING')

  const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'trip', label: 'Overview', icon: Home },
    { key: 'itinerary', label: 'Itinerary', icon: MapPin },
    { key: 'payments', label: 'Payments', icon: CreditCard },
    { key: 'contact', label: 'Contacts', icon: Phone },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-white/8">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/portal')} className="text-slate-500 hover:text-white transition-colors p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-black text-xs">AH</span>
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight truncate">
                {data.bookingRef}
                <span className="ml-2 text-xs font-normal text-slate-400">{data.agent ? `via ${data.agent}` : ''}</span>
              </p>
              <p className="text-xs text-slate-500 truncate">
                {format(new Date(data.arrivalDate), 'dd MMM')} → {format(new Date(data.departureDate), 'dd MMM yyyy')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={data.status} />
            <button
              onClick={() => setRequestModal(true)}
              className="p-2 rounded-xl bg-brand-500/15 border border-brand-500/25 text-brand-400 hover:bg-brand-500/25 transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-2xl mx-auto px-4 flex gap-0 overflow-x-auto scrollbar-hide">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.key === 'payments' && pendingPayments.length > 0 && (
                <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center ml-0.5">
                  {pendingPayments.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Hero banner */}
      {activeTab === 'trip' && (
        <div className="bg-gradient-to-r from-slate-900 via-brand-900/20 to-slate-900 border-b border-white/5 py-6">
          <div className="max-w-2xl mx-auto px-4">
            {/* Countdown */}
            <div className="flex items-center justify-center mb-5">
              {daysUntil > 0 ? (
                <div className="text-center">
                  <div className="flex items-end gap-2 justify-center">
                    <span className="text-5xl font-black text-brand-400">{daysUntil}</span>
                    <span className="text-slate-400 pb-2">days to go</span>
                  </div>
                  <p className="text-slate-500 text-sm">until your trip begins</p>
                </div>
              ) : daysUntil === 0 ? (
                <div className="text-center">
                  <p className="text-3xl font-black text-emerald-400">Today's the day! 🎉</p>
                  <p className="text-slate-400 text-sm mt-1">Have an amazing trip</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-xl font-bold text-slate-300">Trip completed</p>
                  <p className="text-slate-500 text-sm">We hope you had a great time!</p>
                </div>
              )}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Adults', value: data.paxAdults, icon: Users },
                { label: 'Nights', value: totalNights, icon: Hotel },
                { label: 'Cities', value: cities.length, icon: MapPin },
                { label: 'Flights', value: data.flights.length, icon: Plane },
              ].map(s => (
                <div key={s.label} className="bg-white/5 border border-white/8 rounded-xl p-3 text-center">
                  <s.icon className="w-4 h-4 text-slate-400 mx-auto mb-1" />
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="max-w-2xl mx-auto px-4 py-5 pb-24 space-y-4">

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'trip' && (
          <>
            {/* Payment alert */}
            {pendingPayments.length > 0 && (
              <button
                onClick={() => setActiveTab('payments')}
                className="w-full flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-left"
              >
                <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-300">{pendingPayments.length} Payment{pendingPayments.length > 1 ? 's' : ''} Pending</p>
                  <p className="text-xs text-amber-500/80">Tap to view and confirm</p>
                </div>
                <ChevronRight className="w-4 h-4 text-amber-400" />
              </button>
            )}

            {/* Passengers */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-brand-400" />
                <h3 className="text-sm font-bold text-white">Travellers</h3>
              </div>
              <div className="space-y-2">
                {data.passengers.map(p => (
                  <div key={p.id} className="flex items-center gap-3 p-4 bg-white/5 border border-white/8 rounded-2xl">
                    <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-300 text-sm font-bold flex-shrink-0">
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{p.name}</p>
                      <p className="text-xs text-slate-400 capitalize">{p.type.toLowerCase()}</p>
                    </div>
                    {p.isLead && (
                      <span className="text-[10px] bg-brand-500/20 text-brand-400 px-2 py-0.5 rounded-full font-bold border border-brand-500/20">
                        Lead
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Flights */}
            {data.flights.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Plane className="w-4 h-4 text-brand-400" />
                  <h3 className="text-sm font-bold text-white">Flights</h3>
                </div>
                <div className="space-y-2">
                  {data.flights.map(f => (
                    <div key={f.id} className="p-4 bg-white/5 border border-white/8 rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono font-bold text-brand-300">{f.flightNo}</span>
                        {f.airline && <span className="text-xs text-slate-400">{f.airline}</span>}
                        <span className="text-xs text-slate-500">{format(new Date(f.date), 'dd MMM yyyy')}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-center">
                          <p className="text-lg font-black">{f.fromApt}</p>
                          <p className="text-xs text-slate-400">{f.depTime}</p>
                        </div>
                        <div className="flex-1 flex items-center gap-1">
                          <div className="h-px flex-1 bg-white/20" />
                          <Plane className="w-3.5 h-3.5 text-slate-500" />
                          <div className="h-px flex-1 bg-white/20" />
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-black">{f.toApt}</p>
                          <p className="text-xs text-slate-400">{f.arrTime}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Hotels */}
            {data.accommodations.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Hotel className="w-4 h-4 text-brand-400" />
                  <h3 className="text-sm font-bold text-white">Accommodation</h3>
                </div>
                <div className="space-y-2">
                  {data.accommodations.map(a => (
                    <div key={a.id} className="p-4 bg-white/5 border border-white/8 rounded-2xl">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0">
                          <Hotel className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold">{a.hotel}</p>
                          <p className="text-xs text-brand-400 mt-0.5">{a.city}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                            <span>{format(new Date(a.checkIn), 'dd MMM')} → {format(new Date(a.checkOut), 'dd MMM')}</span>
                            <span className="text-slate-600">·</span>
                            <span>{a.nights} night{a.nights !== 1 ? 's' : ''}</span>
                            {a.roomType && <><span className="text-slate-600">·</span><span>{a.roomType}</span></>}
                          </div>
                          {a.contact && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-cyan-400">
                              <Phone className="w-3 h-3" /> {a.contact}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ── ITINERARY TAB ── */}
        {activeTab === 'itinerary' && (
          <section>
            {!data.agenda || data.agenda.items.length === 0 ? (
              <div className="text-center py-16">
                <MapPin className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500">Itinerary not yet available</p>
                <p className="text-slate-600 text-xs mt-1">Your day-by-day plan will appear here once confirmed</p>
              </div>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-5 top-5 bottom-5 w-px bg-white/10" />

                <div className="space-y-4">
                  {data.agenda.items.map((item, i) => (
                    <div key={item.id} className="flex gap-4">
                      {/* Day number */}
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-brand-500/15 border border-brand-500/25 flex items-center justify-center z-10">
                        <span className="text-brand-400 text-xs font-black">{i + 1}</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <p className="font-bold text-sm">{item.location}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{format(new Date(item.date), 'EEEE, dd MMM')}</p>
                            </div>
                            {item.mealPlan && (
                              <span className="text-[10px] bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full font-semibold border border-amber-500/20 flex-shrink-0">
                                {item.mealPlan}
                              </span>
                            )}
                          </div>

                          {(item.fromPoint || item.toPoint) && (
                            <div className="flex items-center gap-2 text-xs text-slate-300 mb-2">
                              {item.fromPoint && <span className="text-slate-500">{item.fromPoint}</span>}
                              {item.fromPoint && <ChevronRight className="w-3 h-3 text-slate-600" />}
                              {item.toPoint && <span>{item.toPoint}</span>}
                            </div>
                          )}

                          {item.details && (
                            <p className="text-xs text-slate-400 leading-relaxed mb-2">{item.details}</p>
                          )}

                          {item.meetingTime && (
                            <div className="flex items-center gap-1.5 text-xs text-brand-400 mb-2">
                              <Clock className="w-3 h-3" />
                              Meet at <span className="font-semibold">{item.meetingTime}</span>
                            </div>
                          )}

                          {/* Driver card */}
                          {item.assignment?.driverName && (
                            <div className="mt-3 flex items-center gap-3 bg-blue-500/8 border border-blue-500/20 rounded-xl p-3">
                              <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                                <Car className="w-4 h-4 text-blue-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-blue-300">{item.assignment.driverName}</p>
                                <p className="text-[11px] text-slate-400">
                                  {[item.assignment.vehicleType, item.assignment.vehiclePlate].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                              {item.assignment.driverPhone && (
                                <a
                                  href={`tel:${item.assignment.driverPhone}`}
                                  className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0"
                                >
                                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── PAYMENTS TAB ── */}
        {activeTab === 'payments' && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-5 bg-emerald-500/8 border border-emerald-500/20 rounded-2xl text-center">
                <p className="text-xs text-slate-400 mb-1">Confirmed Paid</p>
                <p className="text-2xl font-black text-emerald-400">{formatCurrency(totalPaid)}</p>
              </div>
              <div className="p-5 bg-white/5 border border-white/8 rounded-2xl text-center">
                <p className="text-xs text-slate-400 mb-1">Transactions</p>
                <p className="text-2xl font-black">{data.payments.length}</p>
              </div>
            </div>

            {data.payments.length === 0 ? (
              <div className="text-center py-12">
                <CreditCard className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500">No payments recorded yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.payments.map(p => (
                  <div key={p.id} className="p-4 bg-white/5 border border-white/8 rounded-2xl">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">
                          {p.label ?? p.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_COLOR[p.status] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                            {p.status}
                          </span>
                          {p.method && <span className="text-xs text-slate-500">{p.method}</span>}
                          {p.refNumber && (
                            <span className="text-xs font-mono text-slate-400">Ref: {p.refNumber}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <p className="font-bold">{formatCurrency(Number(p.amount), p.currency)}</p>
                        {p.paidAt && (
                          <p className="text-xs text-slate-500">{format(new Date(p.paidAt), 'dd MMM yyyy')}</p>
                        )}
                      </div>
                    </div>
                    {p.status === 'CONFIRMED' && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-500">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Payment confirmed by accounts team
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── CONTACTS TAB ── */}
        {activeTab === 'contact' && (
          <>
            <div className="p-4 bg-brand-500/8 border border-brand-500/20 rounded-2xl">
              <p className="text-sm font-semibold text-brand-300 mb-1">Need Help?</p>
              <p className="text-xs text-slate-400">Contact your dedicated travel experience team for any questions or changes to your booking.</p>
            </div>

            {/* Drivers from itinerary */}
            {data.agenda?.items.some(i => i.assignment?.driverName) && (
              <section>
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Car className="w-4 h-4 text-brand-400" /> Your Drivers
                </h3>
                <div className="space-y-2">
                  {data.agenda.items.filter(i => i.assignment?.driverName).map(item => (
                    <div key={item.id} className="flex items-center gap-3 p-4 bg-white/5 border border-white/8 rounded-2xl">
                      <div className="w-11 h-11 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                        <Car className="w-5 h-5 text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold">{item.assignment!.driverName}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {item.location} · {format(new Date(item.date), 'dd MMM')}
                          {item.assignment!.vehiclePlate && ` · ${item.assignment!.vehiclePlate}`}
                        </p>
                      </div>
                      {item.assignment!.driverPhone && (
                        <a
                          href={`tel:${item.assignment!.driverPhone}`}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex-shrink-0"
                        >
                          <Phone className="w-3.5 h-3.5" /> Call
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Emergency info */}
            <div className="p-4 bg-white/5 border border-white/8 rounded-2xl">
              <h4 className="text-sm font-bold text-white mb-3">Emergency Information</h4>
              <div className="space-y-2 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  Vietnam Emergency: <span className="text-white font-mono">113 / 114 / 115</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  Tourist Police: <span className="text-white font-mono">+84 28 3822 6228</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom action button — mobile floating */}
      <div className="fixed bottom-0 left-0 right-0 z-30 p-4 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent pointer-events-none">
        <div className="max-w-2xl mx-auto pointer-events-auto">
          <button
            onClick={() => setRequestModal(true)}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-all shadow-2xl shadow-brand-500/30"
          >
            <MessageCircle className="w-4 h-4" />
            Request a Change or Help
          </button>
        </div>
      </div>

      {/* Request Modal */}
      {requestModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setRequestModal(false)} />
          <div className="relative w-full sm:max-w-lg bg-slate-900 border border-white/10 rounded-t-3xl sm:rounded-2xl p-6 pb-8 sm:pb-6">
            <div className="w-10 h-1 rounded-full bg-slate-700 mx-auto mb-5 sm:hidden" />
            <h3 className="text-lg font-bold mb-1">Request Update or Change</h3>
            <p className="text-slate-400 text-sm mb-4">Describe your request and our team will get back to you shortly.</p>
            <textarea
              value={requestNote}
              onChange={e => setRequestNote(e.target.value)}
              rows={4}
              placeholder="e.g. Can we change the check-in date for Hanoi hotel? Or I need a vehicle upgrade…"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={submitRequest}
                disabled={submitting || !requestNote.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm disabled:opacity-50 transition-all"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send Request
              </button>
              <button
                onClick={() => setRequestModal(false)}
                className="px-5 rounded-xl bg-white/8 border border-white/10 text-slate-400 hover:text-white text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
