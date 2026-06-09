'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ClipboardCheck, Loader2, ArrowRight, Calendar, Users } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

interface Booking {
  id: string; bookingRef: string; agent: string | null; status: string
  arrivalDate: string; paxAdults: number; paxChildren: number
  passengers: { name: string; isLead: boolean }[]
  fileHandler: string | null; createdBy: { name: string }
}

export default function GroundReviewPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/bookings?status=GT_REVIEW')
      .then(r => r.json())
      .then(j => { if (j.success) setBookings(j.data.bookings) })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <Header title="Review Queue" subtitle="Bookings awaiting Ground Team verification" />
      <div className="p-8 space-y-4">
        {loading ? (
          <div className="flex justify-center h-48"><Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-12" /></div>
        ) : bookings.length === 0 ? (
          <Card className="p-16 text-center">
            <ClipboardCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm font-medium">No bookings pending review</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {bookings.map(b => {
              const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
              return (
                <Card key={b.id} hover className="p-5" onClick={() => router.push(`/dashboard/bookings/${b.bookingRef}`)}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-bold font-mono text-slate-900">{b.bookingRef}</span>
                        <StatusBadge status={b.status as import('@prisma/client').BookingStatus} />
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" /> {lead?.name ?? '—'} (+{(b.paxAdults + b.paxChildren) - 1} more)
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> {formatDate(b.arrivalDate)}
                        </span>
                        <span>Agent: {b.agent ?? '—'}</span>
                        <span>Handler: {b.fileHandler ?? b.createdBy?.name}</span>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-300 flex-shrink-0" />
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
