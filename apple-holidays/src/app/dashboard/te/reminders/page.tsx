'use client'

import { useEffect, useState } from 'react'
import { Loader2, Bell, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, getDaysUntilTrip } from '@/lib/utils'
import Link from 'next/link'
import type { BookingStatus } from '@prisma/client'

interface Booking {
  id: string; bookingRef: string; status: BookingStatus; arrivalDate: string
  recheckCompletedAt: string | null; paxAdults: number
  passengers: { name: string; isLead: boolean }[]
}

export default function RemindersPage() {
  const { countryFilter } = useCountryFilter()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams({ limit: '50' })
    if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
    fetch(`/api/bookings?${params}`)
      .then(r => r.json())
      .then(j => { if (j.success) setBookings(j.data.bookings) })
      .finally(() => setLoading(false))
  }, [countryFilter])

  const activeBookings = bookings.filter(b =>
    !['COMPLETED', 'CANCELLED'].includes(b.status) && getDaysUntilTrip(b.arrivalDate) > 0,
  )

  const recheckNeeded = activeBookings.filter(b => {
    const days = getDaysUntilTrip(b.arrivalDate)
    return days <= 7 && !b.recheckCompletedAt
  })

  const cancelWindow = activeBookings.filter(b => {
    const days = getDaysUntilTrip(b.arrivalDate)
    return days <= 21
  })

  return (
    <div>
      <Header title="Reminders & Alerts" subtitle="Time-sensitive booking actions" />
      <div className="p-8 space-y-6">

        {loading ? (
          <div className="flex justify-center h-48"><Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-12" /></div>
        ) : (
          <>
            {/* T-7 recheck alerts */}
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  T−7 Recheck Required ({recheckNeeded.length})
                </h3>
              </CardHeader>
              <CardBody className="p-0">
                {recheckNeeded.length === 0 ? (
                  <div className="flex items-center gap-3 px-6 py-5 text-slate-400">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="text-sm">All bookings within T−7 have been rechecked</span>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {recheckNeeded.map(b => {
                      const days = getDaysUntilTrip(b.arrivalDate)
                      const lead = b.passengers.find(p => p.isLead)
                      return (
                        <div key={b.id} className="flex items-center justify-between px-6 py-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-sm">{b.bookingRef}</span>
                              <Badge color="red">T−{days}</Badge>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {lead?.name ?? '—'} · Arrives {formatDate(b.arrivalDate)}
                            </p>
                          </div>
                          <Link href={`/dashboard/bookings/${b.bookingRef}`}
                            className="btn btn-secondary btn-sm">
                            Recheck
                          </Link>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Cancellation window */}
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-orange-500" />
                  Cancellation Penalty Window Active ({cancelWindow.length})
                </h3>
              </CardHeader>
              <CardBody className="p-0">
                {cancelWindow.length === 0 ? (
                  <p className="px-6 py-5 text-sm text-slate-400">No bookings in the 21-day penalty window</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {cancelWindow.map(b => {
                      const days = getDaysUntilTrip(b.arrivalDate)
                      return (
                        <div key={b.id} className="flex items-center justify-between px-6 py-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-sm">{b.bookingRef}</span>
                              <Badge color="orange">100% penalty applies</Badge>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {days} day{days !== 1 ? 's' : ''} until arrival · {formatDate(b.arrivalDate)}
                            </p>
                          </div>
                          <Link href={`/dashboard/bookings/${b.bookingRef}`}
                            className="btn btn-secondary btn-sm">
                            View
                          </Link>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Upcoming trips */}
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-blue-500" />
                  All Active Bookings ({activeBookings.length})
                </h3>
              </CardHeader>
              <CardBody className="p-0">
                {activeBookings.length === 0 ? (
                  <p className="px-6 py-5 text-sm text-slate-400">No active bookings</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {activeBookings.map(b => {
                      const days = getDaysUntilTrip(b.arrivalDate)
                      const lead = b.passengers.find(p => p.isLead)
                      return (
                        <div key={b.id} className="flex items-center justify-between px-6 py-3">
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-semibold text-sm">{b.bookingRef}</span>
                            <span className="text-xs text-slate-500">{lead?.name ?? '—'}</span>
                            {b.recheckCompletedAt && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge color={days <= 7 ? 'red' : days <= 21 ? 'orange' : 'blue'}>
                              T−{days}
                            </Badge>
                            <Link href={`/dashboard/bookings/${b.bookingRef}`}
                              className="text-xs text-brand-600 hover:underline">View</Link>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
