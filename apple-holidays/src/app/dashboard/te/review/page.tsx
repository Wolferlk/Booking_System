'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ClipboardCheck, Calendar, Users, Clock, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatDate, getDaysUntilTrip } from '@/lib/utils'

export default function TEReviewPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const role = session?.user?.role ?? ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [bookings, setBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'GT_REVIEW' | 'GT_VERIFIED' | 'all'>('GT_REVIEW')

  useEffect(() => {
    if (role && !['TE_USER', 'SUPER_ADMIN'].includes(role)) {
      router.replace('/dashboard')
      return
    }
    let mounted = true
    setLoading(true)
    ;(async () => {
      try {
        const r = await fetch('/api/bookings?status=GT_REVIEW,GT_VERIFIED,CHANGE_REQUESTED&limit=100')
        const text = await r.text()
        if (!r.ok) {
          console.error('Bookings fetch failed', r.status, text)
          return
        }
        if (!text) {
          console.warn('Bookings API returned empty body')
          return
        }
        let j
        try { j = JSON.parse(text) } catch (e) {
          console.error('Invalid JSON from bookings API', text.slice(0, 200))
          return
        }
        if (mounted && j?.success) setBookings(j.data?.bookings ?? j.data ?? [])
      } catch (err) {
        console.error('Fetch bookings error', err)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [role])

  const filtered = filter === 'all'
    ? bookings
    : bookings.filter(b => b.status === filter)

  const counts = {
    pending: bookings.filter(b => b.status === 'GT_REVIEW').length,
    changes: bookings.filter(b => b.status === 'CHANGE_REQUESTED').length,
    confirmed: bookings.filter(b => b.status === 'GT_VERIFIED').length,
  }

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="w-7 h-7 animate-spin text-brand-500" />
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <Header title="TE Review Queue" subtitle="Travel Experience review and client confirmation" />

      <div className="p-6 space-y-5 flex-1">
        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-4">
            <p className="text-xs text-yellow-600 font-medium uppercase tracking-wide">Pending Review</p>
            <p className="text-2xl font-bold text-yellow-700 mt-1">{counts.pending}</p>
          </div>
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
            <p className="text-xs text-orange-600 font-medium uppercase tracking-wide">Changes Requested</p>
            <p className="text-2xl font-bold text-orange-700 mt-1">{counts.changes}</p>
          </div>
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
            <p className="text-xs text-teal-600 font-medium uppercase tracking-wide">Client Confirmed</p>
            <p className="text-2xl font-bold text-teal-700 mt-1">{counts.confirmed}</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {[
            { key: 'GT_REVIEW', label: 'Pending Review' },
            { key: 'GT_VERIFIED', label: 'Client Confirmed' },
            { key: 'all', label: 'All' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as typeof filter)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === tab.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Bookings list */}
        {filtered.length === 0 ? (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="w-10 h-10 text-slate-300 mb-3" />
                <p className="text-slate-500 font-medium">All clear</p>
                <p className="text-slate-400 text-sm mt-1">No bookings in this queue</p>
              </div>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(b => {
              const days = getDaysUntilTrip(b.arrivalDate)
              const isUrgent = days !== null && days <= 7
              return (
                <Card key={b.id} className={isUrgent ? 'border-orange-200' : ''}>
                  <CardBody>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 font-mono">{b.bookingRef}</span>
                            <StatusBadge status={b.status} />
                            {isUrgent && (
                              <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                <AlertCircle className="w-3 h-3" /> {days}d
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-500 mt-0.5">{b.agent}</p>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {formatDate(b.arrivalDate)} → {formatDate(b.departureDate)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {b.paxAdults}A {b.paxChildren > 0 ? `${b.paxChildren}C` : ''}
                          </span>
                          {b.fileHandler && (
                            <span className="flex items-center gap-1">
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              {b.fileHandler}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {b.status === 'CHANGE_REQUESTED' && (
                          <span className="text-xs text-orange-600 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" /> Awaiting correction
                          </span>
                        )}
                        <Link
                          href={`/dashboard/bookings/${b.bookingRef}`}
                          className="btn btn-primary btn-sm"
                        >
                          {b.status === 'GT_REVIEW' ? 'Review & Confirm' : 'View Booking'}
                        </Link>
                      </div>
                    </div>

                    {/* Change requests */}
                    {b.changeRequests?.filter((cr: { status: string }) => cr.status === 'OPEN').map((cr: { id: string; notes: string }) => (
                      <div key={cr.id} className="mt-3 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 text-xs text-orange-700">
                        <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                        {cr.notes}
                      </div>
                    ))}
                  </CardBody>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
