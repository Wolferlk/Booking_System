'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Globe, Loader2, ChevronRight, MapPin, Calendar, Users, LogOut } from 'lucide-react'
import { format } from 'date-fns'
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

const STATUS_COLOR: Partial<Record<BookingStatus, string>> = {
  BT_CONFIRMED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  GT_VERIFIED: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  OPERATIONS_READY: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  CLIENT_LIVE: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  IN_PROGRESS: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  COMPLETED: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  CANCELLED: 'bg-red-500/15 text-red-400 border-red-500/20',
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
      {/* Header */}
      <div className="bg-slate-950/95 backdrop-blur border-b border-white/8 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center">
              <span className="text-white font-black text-sm">AH</span>
            </div>
            <div>
              <p className="font-bold text-sm leading-none">Apple Holidays</p>
              <p className="text-xs text-slate-500 mt-0.5">My Trips</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors px-3 py-2 rounded-xl hover:bg-white/5"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Welcome */}
        <div className="mb-6">
          <h1 className="text-2xl font-black">
            Hey, {session?.user?.name?.split(' ')[0] ?? 'Traveller'} 👋
          </h1>
          <p className="text-slate-400 text-sm mt-1">Here are your upcoming adventures</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-5">
              <Globe className="w-10 h-10 text-slate-600" />
            </div>
            <p className="text-slate-400 font-semibold">No trips found</p>
            <p className="text-slate-600 text-sm mt-1">Your bookings will appear here once confirmed</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map(b => {
              const color = STATUS_COLOR[b.status] ?? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
              return (
                <button
                  key={b.id}
                  onClick={() => router.push(`/portal/${b.bookingRef}`)}
                  className="w-full text-left p-5 rounded-2xl border border-white/8 bg-white/3 active:bg-white/8 hover:bg-white/6 hover:border-white/15 transition-all group"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-5 h-5 text-brand-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-base truncate">{b.bookingRef}</span>
                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                      </div>
                      <p className="text-sm text-slate-300 font-medium truncate">
                        {b.passengers[0]?.name ?? 'Traveller'}
                        {b.passengers.length > 1 ? ` +${b.passengers.length - 1}` : ''}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(b.arrivalDate), 'dd MMM')} → {format(new Date(b.departureDate), 'dd MMM yyyy')}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <Users className="w-3 h-3" />
                          {b.paxAdults}{b.paxChildren > 0 ? `+${b.paxChildren}` : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <span className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${color}`}>
                      {b.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
