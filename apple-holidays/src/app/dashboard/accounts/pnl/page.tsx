'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, BarChart2, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { BookingStatus } from '@prisma/client'

interface Booking {
  id: string; bookingRef: string; status: BookingStatus; arrivalDate: string
  paxAdults: number; paxChildren: number; quotedTotal: string; currency: string
  passengers: { name: string; isLead: boolean }[]
}

export default function AccountsPNLPage() {
  const router = useRouter()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/bookings?status=AWAITING_PAYMENT_CONFIRM').then(r => r.json()),
      fetch('/api/bookings?status=GT_VERIFIED').then(r => r.json()),
      fetch('/api/bookings?status=OPERATIONS_READY').then(r => r.json()),
    ]).then(([a, b, c]) => {
      const all = [
        ...(a.success ? a.data.bookings : []),
        ...(b.success ? b.data.bookings : []),
        ...(c.success ? c.data.bookings : []),
      ]
      setBookings(all)
    }).finally(() => setLoading(false))
  }, [])

  const awaiting = bookings.filter(b => b.status === 'AWAITING_PAYMENT_CONFIRM')
  const verified = bookings.filter(b => b.status === 'GT_VERIFIED')

  return (
    <div>
      <Header
        title="P&L Management"
        subtitle="Upload and confirm P&L for bookings awaiting payment"
      />
      <div className="p-8 space-y-6">

        {awaiting.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm font-medium text-amber-800">
              <span className="font-bold">{awaiting.length}</span> booking(s) awaiting your payment confirmation — Ground Team cannot purchase tickets until confirmed.
            </p>
          </div>
        )}

        {verified.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl">
            <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <p className="text-sm font-medium text-blue-800">
              <span className="font-bold">{verified.length}</span> booking(s) verified by Ground — upload P&L to advance.
            </p>
          </div>
        )}

        <Card>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No bookings require P&L action</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Booking Ref</th><th>Lead Passenger</th><th>Arrival</th>
                  <th>Pax</th><th>Quoted</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => {
                  const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
                  return (
                    <tr key={b.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/bookings/${b.bookingRef}/pnl`)}>
                      <td className="font-mono font-semibold">{b.bookingRef}</td>
                      <td>{lead?.name ?? '—'}</td>
                      <td className="text-xs">{formatDate(b.arrivalDate)}</td>
                      <td>{b.paxAdults + b.paxChildren}</td>
                      <td className="font-semibold">{formatCurrency(b.quotedTotal, b.currency)}</td>
                      <td><StatusBadge status={b.status} /></td>
                      <td>
                        <button className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                          {b.status === 'GT_VERIFIED' ? 'Upload P&L' : 'Confirm Payments'}
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}
