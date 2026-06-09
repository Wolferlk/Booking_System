'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Plus, Search, Filter, FileText, Loader2, ArrowRight, Users, Calendar,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import { formatDate, formatCurrency } from '@/lib/utils'
import { STATUS_LABELS } from '@/lib/state-machine'
import { useSession } from 'next-auth/react'
import type { BookingStatus } from '@prisma/client'

const STATUSES = Object.keys(STATUS_LABELS) as BookingStatus[]

interface Booking {
  id: string
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  status: BookingStatus
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: string
  currency: string
  passengers: { name: string; isLead: boolean }[]
  createdBy: { name: string }
  _count: { changeRequests: number }
}

export default function BookingsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [bookings, setBookings] = useState<Booking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    try {
      const res = await fetch(`/api/bookings?${params}`)
      const json = await res.json()
      if (json.success) {
        setBookings(json.data.bookings)
        setTotal(json.data.total)
      }
    } finally {
      setLoading(false)
    }
  }, [search, status])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const role = session?.user?.role
  const canCreate = ['BT_USER', 'SUPER_ADMIN'].includes(role ?? '')

  return (
    <div>
      <Header
        title="Bookings"
        subtitle={`${total} total booking${total !== 1 ? 's' : ''}`}
        actions={
          canCreate ? (
            <Button onClick={() => router.push('/dashboard/bookings/new')} icon={<Plus className="w-4 h-4" />}>
              New Booking
            </Button>
          ) : undefined
        }
      />

      <div className="p-8 space-y-5">
        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by ref, agent, passenger name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="form-input pl-9"
              />
            </div>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="form-select w-full sm:w-52"
            >
              <option value="">All statuses</option>
              {STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </Card>

        {/* Table */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
            </div>
          ) : bookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No bookings found</p>
              {canCreate && (
                <Link href="/dashboard/bookings/new" className="mt-3 text-sm text-brand-600 hover:underline">
                  Create your first booking
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Booking Ref</th>
                    <th>Lead Passenger</th>
                    <th>Agent</th>
                    <th>Trip Dates</th>
                    <th>Pax</th>
                    <th>Quoted</th>
                    <th>Status</th>
                    <th>Handler</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bookings.map(b => {
                    const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
                    return (
                      <tr
                        key={b.id}
                        className="cursor-pointer hover:bg-slate-50 transition-colors"
                        onClick={() => router.push(`/dashboard/bookings/${b.bookingRef}`)}
                      >
                        <td>
                          <span className="font-semibold text-slate-900 font-mono">{b.bookingRef}</span>
                          {b._count.changeRequests > 0 && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">
                              {b._count.changeRequests} change{b._count.changeRequests > 1 ? 's' : ''}
                            </span>
                          )}
                        </td>
                        <td>{lead?.name ?? '—'}</td>
                        <td className="text-slate-500">{b.agent ?? '—'}</td>
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <Calendar className="w-3 h-3 flex-shrink-0" />
                            {formatDate(b.arrivalDate)} → {formatDate(b.departureDate)}
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <Users className="w-3 h-3" />
                            {b.paxAdults + b.paxChildren}
                          </div>
                        </td>
                        <td className="font-semibold text-slate-800">
                          {formatCurrency(b.quotedTotal, b.currency)}
                        </td>
                        <td><StatusBadge status={b.status} /></td>
                        <td className="text-slate-500 text-xs">{b.fileHandler ?? b.createdBy?.name ?? '—'}</td>
                        <td>
                          <ArrowRight className="w-4 h-4 text-slate-300" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
