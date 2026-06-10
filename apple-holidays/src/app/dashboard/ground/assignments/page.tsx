'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Loader2, Car, Phone, CalendarDays, Users, MapPin,
  AlertCircle, CheckCircle2, ExternalLink, Calendar,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

interface Slot {
  agendaItemId:  string
  bookingRef:    string
  bookingStatus: string
  arrivalDate:   string
  departureDate: string
  leadPassenger: string | null
  paxAdults:     number
  paxChildren:   number
  date:          string
  location:      string
  fromPoint:     string | null
  toPoint:       string | null
  details:       string | null
  meetingTime:   string | null
  serviceType:   string
  assignment: {
    id:           string
    driverId:     string | null
    driverName:   string | null
    driverPhone:  string | null
    vehicleType:  string | null
    vehiclePlate: string | null
    notes:        string | null
  } | null
}

type GroupedDay = { date: string; slots: Slot[] }

function groupByDate(slots: Slot[]): GroupedDay[] {
  const map = new Map<string, Slot[]>()
  for (const s of slots) {
    const key = s.date.slice(0, 10)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({ date, slots }))
}

const SVC_COLOR: Record<string, string> = {
  PVT_TRANSFER:    'bg-blue-100 text-blue-700 border-blue-200',
  SIC_TRANSFER:    'bg-green-100 text-green-700 border-green-200',
  OWN_ARRANGEMENT: 'bg-slate-100 text-slate-500 border-slate-200',
}
const SVC_LABEL: Record<string, string> = {
  PVT_TRANSFER:    'PVT Transfer',
  SIC_TRANSFER:    'SIC Transfer',
  OWN_ARRANGEMENT: 'Own Arrangement',
}

export default function AssignmentsPage() {
  const router = useRouter()
  const [slots,   setSlots]   = useState<Slot[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<'all' | 'unassigned' | 'assigned'>('all')

  useEffect(() => {
    fetch('/api/ground/assignments')
      .then(r => r.json())
      .then(j => { if (j.success) setSlots(j.data); else toast.error(j.error ?? 'Failed') })
      .finally(() => setLoading(false))
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = slots.filter(s => s.date.slice(0, 10) >= today)
  const past     = slots.filter(s => s.date.slice(0, 10) <  today)

  const filtered = (list: Slot[]) => {
    if (filter === 'unassigned') return list.filter(s => !s.assignment?.driverName)
    if (filter === 'assigned')   return list.filter(s =>  s.assignment?.driverName)
    return list
  }

  const upcomingUnassigned = upcoming.filter(s => !s.assignment?.driverName).length
  const groups = groupByDate(filtered(upcoming))

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
    </div>
  )

  return (
    <div>
      <Header
        title="Driver Assignments"
        subtitle={`${upcoming.length} upcoming slots · ${upcomingUnassigned > 0 ? `${upcomingUnassigned} need a driver` : 'all drivers assigned'}`}
      />

      <div className="p-8 space-y-6 max-w-6xl">

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Upcoming Slots',    value: upcoming.length,                            color: 'text-slate-800' },
            { label: 'Assigned',          value: upcoming.filter(s => s.assignment?.driverName).length, color: 'text-green-600' },
            { label: 'Needs Driver',      value: upcomingUnassigned,                         color: upcomingUnassigned > 0 ? 'text-red-600 font-bold' : 'text-slate-400' },
            { label: 'Past (completed)',  value: past.length,                                color: 'text-slate-400' },
          ].map(k => (
            <div key={k.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{k.label}</div>
              <div className={`text-xl font-bold ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {(['all', 'unassigned', 'assigned'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {f === 'unassigned' ? '⚠ Unassigned' : f === 'assigned' ? '✓ Assigned' : 'All'}
            </button>
          ))}
        </div>

        {/* Grouped by date */}
        {groups.length === 0 ? (
          <Card className="p-16 text-center">
            <CalendarDays className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No upcoming assignments</p>
          </Card>
        ) : (
          groups.map(({ date, slots: daySlots }) => {
            const isToday    = date === today
            const isTomorrow = date === new Date(Date.now() + 86400000).toISOString().slice(0, 10)
            const label      = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : formatDate(date)

            return (
              <div key={date}>
                {/* Date header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    isToday    ? 'bg-red-600 text-white' :
                    isTomorrow ? 'bg-orange-500 text-white' :
                    'bg-slate-200 text-slate-600'
                  }`}>
                    {label}
                  </div>
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs text-slate-400">{daySlots.length} slot{daySlots.length !== 1 ? 's' : ''}</span>
                </div>

                <div className="space-y-3">
                  {daySlots.map(slot => {
                    const hasDriver = !!slot.assignment?.driverName
                    return (
                      <Card key={slot.agendaItemId} className={`overflow-hidden ${!hasDriver ? 'border-red-200' : ''}`}>
                        <div className="flex">
                          {/* Status strip */}
                          <div className={`w-1.5 flex-shrink-0 ${hasDriver ? 'bg-green-400' : 'bg-red-400'}`} />

                          <div className="flex-1 p-4">
                            <div className="flex items-start justify-between gap-4 flex-wrap">

                              {/* Left — booking info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <button
                                    onClick={() => router.push(`/dashboard/bookings/${slot.bookingRef}`)}
                                    className="font-mono font-bold text-brand-700 hover:underline text-sm flex items-center gap-1"
                                  >
                                    {slot.bookingRef}
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                  <StatusBadge status={slot.bookingStatus as never} />
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${SVC_COLOR[slot.serviceType] ?? SVC_COLOR.OWN_ARRANGEMENT}`}>
                                    {SVC_LABEL[slot.serviceType] ?? slot.serviceType}
                                  </span>
                                  {slot.meetingTime && (
                                    <span className="text-xs text-slate-500 flex items-center gap-1">
                                      <Calendar className="w-3 h-3" /> {slot.meetingTime}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                                  <span className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" /> {slot.location}
                                  </span>
                                  {(slot.fromPoint || slot.toPoint) && (
                                    <span>
                                      {slot.fromPoint && `${slot.fromPoint} → `}{slot.toPoint}
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1">
                                    <Users className="w-3 h-3" />
                                    {slot.paxAdults + slot.paxChildren} pax
                                  </span>
                                  {slot.leadPassenger && (
                                    <span className="font-medium text-slate-600">{slot.leadPassenger}</span>
                                  )}
                                </div>

                                {slot.details && (
                                  <p className="text-xs text-slate-400 mt-1 truncate max-w-sm">{slot.details}</p>
                                )}
                              </div>

                              {/* Right — driver info */}
                              <div className="flex-shrink-0 min-w-[180px]">
                                {hasDriver ? (
                                  <div className="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                                    <Car className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <p className="text-sm font-semibold text-blue-800">{slot.assignment!.driverName}</p>
                                      {slot.assignment!.driverPhone && (
                                        <a href={`tel:${slot.assignment!.driverPhone}`}
                                          className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 mt-0.5">
                                          <Phone className="w-3 h-3" /> {slot.assignment!.driverPhone}
                                        </a>
                                      )}
                                      {slot.assignment!.vehiclePlate && (
                                        <p className="text-xs font-mono text-slate-500 mt-0.5">
                                          {slot.assignment!.vehicleType} {slot.assignment!.vehiclePlate}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-xl">
                                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                    <div>
                                      <p className="text-xs font-semibold text-red-700">No Driver Assigned</p>
                                      <button
                                        onClick={() => router.push(`/dashboard/bookings/${slot.bookingRef}/agenda`)}
                                        className="text-[11px] text-red-600 hover:underline mt-0.5"
                                      >
                                        Assign now →
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>

                            </div>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}

        {/* Past slots (collapsed) */}
        {past.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600 flex items-center gap-2 select-none">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {past.length} past slots (click to expand)
            </summary>
            <div className="mt-3 space-y-2 opacity-60">
              {groupByDate(filtered(past)).map(({ date, slots: daySlots }) => (
                <div key={date} className="text-xs text-slate-500 border border-slate-100 rounded-lg px-3 py-2">
                  <strong>{formatDate(date)}</strong> — {daySlots.map(s => s.bookingRef).join(', ')}
                </div>
              ))}
            </div>
          </details>
        )}

      </div>
    </div>
  )
}
