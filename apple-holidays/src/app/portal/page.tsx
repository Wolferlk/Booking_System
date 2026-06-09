'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Globe, Loader2, ArrowRight, MapPin } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { BookingStatus } from '@prisma/client'

interface MyBooking {
  id: string
  bookingRef: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  status: BookingStatus
  passengers: { name: string }[]
}

export default function PortalIndexPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [bookings, setBookings] = useState<MyBooking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/bookings?limit=20')
      .then(r => r.json())
      .then(d => { if (d.success) setBookings(d.data.bookings) })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="flex items-center gap-4 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 flex items-center justify-center">
            <Globe className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">My Trips</h1>
            <p className="text-slate-400 text-sm">Welcome back, {session?.user?.name?.split(' ')[0]}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-16">
            <MapPin className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500">No trips found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map(b => (
              <button
                key={b.id}
                onClick={() => router.push(`/portal/${b.bookingRef}`)}
                className="w-full text-left p-5 rounded-2xl border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-base font-bold">{b.bookingRef}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium">
                        {b.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">
                      {b.passengers[0]?.name ?? 'Traveller'} · {formatDate(b.arrivalDate)} → {formatDate(b.departureDate)}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {b.paxAdults} adult{b.paxAdults !== 1 ? 's' : ''}
                      {b.paxChildren > 0 ? ` · ${b.paxChildren} child${b.paxChildren !== 1 ? 'ren' : ''}` : ''}
                    </p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
