'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plane, Hotel, Users, Calendar, Clock, MapPin,
  ChevronRight, Phone, RefreshCw, Loader2,
  AlertCircle, CheckCircle, Zap, LayoutList, CalendarDays,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import Link from 'next/link'
import DailyOpsView from '@/components/te/daily-ops-view'

type Mode    = 'today' | 'week' | 'range'
type MainTab = 'overview' | 'daily'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Booking = any

const STATUS_COLORS: Record<string, string> = {
  IN_PROGRESS:      'bg-blue-100 text-blue-800',
  CLIENT_LIVE:      'bg-green-100 text-green-800',
  OPERATIONS_READY: 'bg-purple-100 text-purple-800',
  COMPLETED:        'bg-slate-100 text-slate-600',
}

function daysLeft(departure: string) {
  const diff = Math.ceil((new Date(departure).getTime() - Date.now()) / 86400000)
  if (diff < 0) return `${Math.abs(diff)}d ago`
  if (diff === 0) return 'Departing today'
  return `${diff}d left`
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function fmtTime(t: string) {
  return t || '—'
}

// ─── Bookings Overview (existing content) ─────────────────────────────────────

function BookingsOverview() {
  const router = useRouter()
  const [mode, setMode]           = useState<Mode>('today')
  const [fromDate, setFromDate]   = useState('')
  const [toDate, setToDate]       = useState('')
  const [bookings, setBookings]   = useState<Booking[]>([])
  const [loading, setLoading]     = useState(true)
  const [rangeInfo, setRangeInfo] = useState<{ start: string; end: string } | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      let url = `/api/te/live?mode=${mode}`
      if (mode === 'range' && fromDate && toDate) url += `&from=${fromDate}&to=${toDate}`
      const res  = await fetch(url)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setBookings(json.data.bookings)
      setRangeInfo({ start: json.data.rangeStart, end: json.data.rangeEnd })
    } catch (err: unknown) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [mode, fromDate, toDate])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(() => load(true), 120_000)
    return () => clearInterval(id)
  }, [load])

  const today       = new Date().toISOString().slice(0, 10)
  const totalPax    = bookings.reduce((s: number, b: Booking) => s + (b.paxAdults ?? 0) + (b.paxChildren ?? 0), 0)
  const activeCount = bookings.filter((b: Booking) => ['IN_PROGRESS', 'CLIENT_LIVE'].includes(b.status)).length

  const todayFlights = bookings.flatMap((b: Booking) =>
    (b.flights ?? []).filter((f: Booking) => f.date?.slice(0, 10) === today)
      .map((f: Booking) => ({ ...f, bookingRef: b.bookingRef })),
  )

  return (
    <div className="space-y-4">
      {/* Mode controls */}
      <div className="flex gap-2 items-center flex-wrap">
        {(['today', 'week'] as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-secondary'}`}
          >
            {m === 'today' ? 'Today' : 'D-7 (Next 7 Days)'}
          </button>
        ))}
        <button
          onClick={() => setMode('range')}
          className={`btn btn-sm ${mode === 'range' ? 'btn-primary' : 'btn-secondary'}`}
        >
          Custom Range
        </button>
        <button
          onClick={() => load(false)}
          disabled={loading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <Link href="/dashboard/te/analytics" className="btn btn-sm btn-secondary ml-auto">
          Analytics &amp; Compare →
        </Link>
      </div>

      {rangeInfo && (
        <p className="text-xs text-slate-400">
          {fmtDate(rangeInfo.start)} → {fmtDate(rangeInfo.end)} · {bookings.length} active booking{bookings.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Custom range inputs */}
      {mode === 'range' && (
        <Card className="p-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="form-label">From</label>
              <input type="date" className="form-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">To</label>
              <input type="date" className="form-input" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <button onClick={() => load()} disabled={!fromDate || !toDate} className="btn btn-primary btn-sm mb-0.5">
              Apply
            </button>
          </div>
        </Card>
      )}

      {/* Summary stats */}
      {!loading && bookings.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Active Bookings',  value: bookings.length,     color: 'text-brand-600',  icon: <Calendar className="w-5 h-5" /> },
            { label: 'Total Pax',        value: totalPax,             color: 'text-blue-600',   icon: <Users className="w-5 h-5" /> },
            { label: 'In Progress',      value: activeCount,          color: 'text-green-600',  icon: <Zap className="w-5 h-5" /> },
            { label: "Today's Flights",  value: todayFlights.length,  color: 'text-purple-600', icon: <Plane className="w-5 h-5" /> },
          ].map(s => (
            <Card key={s.label} className="p-4 flex items-center gap-3">
              <div className={`${s.color} opacity-80`}>{s.icon}</div>
              <div>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Today's flights strip */}
      {todayFlights.length > 0 && (
        <Card className="p-4 bg-purple-50 border-purple-200">
          <p className="text-xs font-semibold text-purple-700 mb-2 uppercase tracking-wide">Today&apos;s Flights</p>
          <div className="flex gap-3 flex-wrap">
            {todayFlights.map((f: Booking, i: number) => (
              <div key={i} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-purple-100 text-sm">
                <Plane className="w-3.5 h-3.5 text-purple-500" />
                <span className="font-mono font-semibold text-slate-800">{f.flightNo}</span>
                <span className="text-slate-500">{f.fromApt} {fmtTime(f.depTime)} → {f.toApt} {fmtTime(f.arrTime)}</span>
                <span className="text-xs text-purple-600 font-medium">{f.bookingRef}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 gap-3">
          <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          <span className="text-slate-500">Loading bookings…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && bookings.length === 0 && (
        <Card className="p-16 text-center">
          <CheckCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="font-semibold text-slate-500">No active bookings for this period</p>
          <p className="text-sm text-slate-400 mt-1">Try D-7 to see upcoming arrivals</p>
        </Card>
      )}

      {/* Booking cards */}
      {!loading && bookings.map((b: Booking) => {
        const lead       = (b.passengers ?? []).find((p: Booking) => p.isLead) ?? b.passengers?.[0]
        const daysBadge  = daysLeft(b.departureDate)
        const isToday    = b.arrivalDate?.slice(0, 10) === today
        const tonightHotel = (b.accommodations ?? []).find((a: Booking) =>
          a.checkIn?.slice(0, 10) <= today && a.checkOut?.slice(0, 10) > today,
        )
        const nextFlight = (b.flights ?? []).find((f: Booking) => f.date?.slice(0, 10) >= today)

        return (
          <Card key={b.id} className={`overflow-hidden ${isToday ? 'ring-2 ring-brand-400 ring-offset-1' : ''}`}>
            <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-bold font-mono text-slate-900">{b.bookingRef}</span>
                <StatusBadge status={b.status} />
                {isToday && (
                  <span className="text-xs bg-brand-500 text-white px-2 py-0.5 rounded-full font-semibold">Arriving Today</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  daysBadge.includes('ago') ? 'bg-slate-100 text-slate-500' :
                  daysBadge.includes('Departing') ? 'bg-orange-100 text-orange-700' :
                  'bg-blue-50 text-blue-700'
                }`}>
                  {daysBadge}
                </span>
              </div>
              <button
                onClick={() => router.push(`/dashboard/bookings/${b.bookingRef}`)}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium flex-shrink-0"
              >
                View <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="px-5 pb-2 flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {fmtDate(b.arrivalDate)} → {fmtDate(b.departureDate)}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {b.paxAdults}A {b.paxChildren > 0 ? `${b.paxChildren}C` : ''} · {b.agent}
              </span>
              {b.fileHandler && <span className="text-slate-400">Handler: {b.fileHandler}</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 border-t border-slate-100">
              {/* Passengers */}
              <div className="px-5 py-3 border-b md:border-b-0 md:border-r border-slate-100">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Passengers
                </p>
                <div className="space-y-1">
                  {(b.passengers ?? []).slice(0, 4).map((p: Booking) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        p.isLead ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {p.name?.charAt(0)}
                      </div>
                      <span className="text-xs text-slate-700 truncate">{p.name}</span>
                      {p.isLead && <span className="text-[9px] text-brand-500 font-semibold">LEAD</span>}
                      <span className="text-[10px] text-slate-400 ml-auto">{p.type}</span>
                    </div>
                  ))}
                  {(b.passengers ?? []).length > 4 && (
                    <p className="text-[10px] text-slate-400">+{b.passengers.length - 4} more</p>
                  )}
                </div>
                {(b.emergencyContacts ?? []).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    {b.emergencyContacts.slice(0, 2).map((ec: Booking) => (
                      <div key={ec.id} className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Phone className="w-2.5 h-2.5" />
                        <span>{ec.name}</span>
                        {ec.phone && <span className="font-mono">{ec.phone}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Flights */}
              <div className="px-5 py-3 border-b md:border-b-0 md:border-r border-slate-100">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Plane className="w-3 h-3" /> Flights
                </p>
                {nextFlight ? (
                  <div className="space-y-1.5">
                    <div className="bg-blue-50 rounded-lg p-2 border border-blue-100">
                      <p className="text-[9px] text-blue-500 font-semibold mb-0.5">NEXT FLIGHT</p>
                      <p className="text-sm font-bold font-mono text-slate-800">{nextFlight.flightNo}</p>
                      <p className="text-xs text-slate-600">
                        {nextFlight.fromApt} {fmtTime(nextFlight.depTime)} → {nextFlight.toApt} {fmtTime(nextFlight.arrTime)}
                      </p>
                      <p className="text-[10px] text-blue-600 font-medium">{fmtDate(nextFlight.date)}</p>
                    </div>
                    {(b.flights ?? []).filter((f: Booking) => f.id !== nextFlight.id).slice(0, 3).map((f: Booking) => (
                      <div key={f.id} className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono text-slate-700">{f.flightNo}</span>
                        <span>{f.fromApt}→{f.toApt}</span>
                        <span className="ml-auto text-slate-400">{fmtDate(f.date)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No upcoming flights</p>
                )}
              </div>

              {/* Accommodation */}
              <div className="px-5 py-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Hotel className="w-3 h-3" /> Accommodation
                </p>
                {tonightHotel ? (
                  <div className="space-y-1.5">
                    <div className="bg-green-50 rounded-lg p-2 border border-green-100">
                      <p className="text-[9px] text-green-600 font-semibold mb-0.5">TONIGHT</p>
                      <p className="text-sm font-semibold text-slate-800 leading-tight">{tonightHotel.hotel}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-2.5 h-2.5" />{tonightHotel.city}
                      </p>
                      {tonightHotel.roomType && <p className="text-[10px] text-slate-400">{tonightHotel.roomType}</p>}
                    </div>
                    {(b.accommodations ?? []).filter((a: Booking) => a.id !== tonightHotel.id).slice(0, 2).map((a: Booking) => (
                      <div key={a.id} className="text-xs text-slate-500 flex justify-between">
                        <span className="truncate">{a.hotel}</span>
                        <span className="text-slate-400 ml-2 flex-shrink-0">{fmtDate(a.checkIn)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {(b.accommodations ?? []).slice(0, 3).map((a: Booking) => (
                      <div key={a.id} className="text-xs text-slate-500 flex justify-between">
                        <span className="truncate">{a.hotel}</span>
                        <span className="text-slate-400 ml-2 flex-shrink-0">{fmtDate(a.checkIn)}</span>
                      </div>
                    ))}
                    {(b.accommodations ?? []).length === 0 && (
                      <p className="text-xs text-slate-400">No accommodation</p>
                    )}
                  </div>
                )}
                {(b.tourAgenda?.items ?? []).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Movement</p>
                    {b.tourAgenda.items.slice(0, 2).map((item: Booking) => (
                      <div key={item.id} className="text-[10px] text-slate-500 flex gap-1">
                        <span className="text-slate-400 flex-shrink-0">{fmtDate(item.date)}</span>
                        <span className="truncate">{item.location}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {(() => {
              const daysToDepart = Math.ceil((new Date(b.departureDate).getTime() - Date.now()) / 86400000)
              if (daysToDepart >= 0 && daysToDepart <= 2) {
                return (
                  <div className="px-5 py-2 bg-orange-50 border-t border-orange-200 flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                    <p className="text-xs text-orange-700 font-medium">
                      {daysToDepart === 0 ? 'Departing today' : `Departing in ${daysToDepart} day${daysToDepart > 1 ? 's' : ''}`} — please confirm all details
                    </p>
                    <Clock className="w-3 h-3 text-orange-400 ml-auto" />
                  </div>
                )
              }
              return null
            })()}
          </Card>
        )
      })}
    </div>
  )
}

// ─── Page shell with sub-tabs ─────────────────────────────────────────────────

export default function TELivePage() {
  const [tab, setTab] = useState<MainTab>('overview')

  const TABS: { value: MainTab; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      value: 'overview',
      label: 'Bookings Overview',
      icon: <LayoutList className="w-4 h-4" />,
      desc: 'All active trips in a range',
    },
    {
      value: 'daily',
      label: 'Daily Operations',
      icon: <CalendarDays className="w-4 h-4" />,
      desc: 'Day-by-day agenda & activities',
    },
  ]

  return (
    <div>
      <Header
        title="Live Travel Overview"
        subtitle="Monitor active bookings and daily operations"
        actions={
          <Link href="/dashboard/te/analytics" className="btn btn-sm btn-secondary">
            Analytics &amp; Compare →
          </Link>
        }
      />

      <div className="p-6 max-w-7xl space-y-5">

        {/* ── Sub-tabs ── */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          {TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        {tab === 'overview' && <BookingsOverview />}
        {tab === 'daily'    && <DailyOpsView />}

      </div>
    </div>
  )
}
