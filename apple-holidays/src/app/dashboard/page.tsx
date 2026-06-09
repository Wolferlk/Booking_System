'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  FileText, Clock, AlertCircle, CreditCard, TrendingUp,
  Globe, Users, Loader2, ArrowRight, CheckCircle2,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, StatCard, CardHeader, CardBody } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import type { UserRole, BookingStatus } from '@prisma/client'

interface Stats {
  totalBookings: number
  activeBookings: number
  pendingReview: number
  awaitingPayment: number
  upcomingTrips: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
  byStatus: Record<string, number>
}

interface RecentBooking {
  id: string
  bookingRef: string
  agent: string | null
  status: BookingStatus
  arrivalDate: string
  paxAdults: number
  paxChildren: number
  passengers: { name: string }[]
  createdBy: { name: string }
}

export default function DashboardPage() {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, bookingsRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/bookings?limit=5'),
        ])
        const [statsJson, bookingsJson] = await Promise.all([
          statsRes.json(),
          bookingsRes.json(),
        ])
        if (statsJson.success) setStats(statsJson.data)
        if (bookingsJson.success) setRecentBookings(bookingsJson.data.bookings)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const isAdmin = role === 'SUPER_ADMIN'
  const isAccounts = role === 'AC_USER'

  return (
    <div>
      <Header
        title={`Welcome back, ${session?.user?.name?.split(' ')[0]} 👋`}
        subtitle="Here's what's happening with your bookings today"
      />

      <div className="p-8 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
          </div>
        ) : (
          <>
            {/* Stats grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <StatCard
                label="Total Bookings"
                value={stats?.totalBookings ?? 0}
                icon={<FileText className="w-5 h-5" />}
                color="blue"
              />
              <StatCard
                label="Active Bookings"
                value={stats?.activeBookings ?? 0}
                icon={<Clock className="w-5 h-5" />}
                color="green"
              />
              <StatCard
                label="Pending Review"
                value={stats?.pendingReview ?? 0}
                icon={<AlertCircle className="w-5 h-5" />}
                color="yellow"
              />
              <StatCard
                label="Upcoming Trips (30d)"
                value={stats?.upcomingTrips ?? 0}
                icon={<Globe className="w-5 h-5" />}
                color="purple"
              />
            </div>

            {/* Financial row (Admin + Accounts) */}
            {(isAdmin || isAccounts) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <StatCard
                  label="Total Revenue (USD)"
                  value={formatCurrency(stats?.totalRevenue ?? 0)}
                  icon={<TrendingUp className="w-5 h-5" />}
                  color="green"
                />
                <StatCard
                  label="Total Cost (USD)"
                  value={formatCurrency(stats?.totalCost ?? 0)}
                  icon={<CreditCard className="w-5 h-5" />}
                  color="orange"
                />
                <StatCard
                  label="Profit (USD)"
                  value={formatCurrency(stats?.totalProfit ?? 0)}
                  icon={<TrendingUp className="w-5 h-5" />}
                  color="purple"
                />
              </div>
            )}

            {/* Awaiting payment alert */}
            {(stats?.awaitingPayment ?? 0) > 0 && (
              <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <p className="text-sm font-medium text-amber-800">
                  <span className="font-bold">{stats?.awaitingPayment}</span> booking(s) awaiting payment confirmation from Accounts Team
                </p>
                <Link
                  href="/dashboard/bookings?status=AWAITING_PAYMENT_CONFIRM"
                  className="ml-auto text-xs text-amber-700 hover:text-amber-900 font-semibold flex items-center gap-1"
                >
                  View <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            )}

            {/* Two-column lower section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent bookings */}
              <Card>
                <CardHeader
                  action={
                    <Link href="/dashboard/bookings" className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1">
                      View all <ArrowRight className="w-3 h-3" />
                    </Link>
                  }
                >
                  <h3 className="text-base font-semibold text-slate-900">Recent Bookings</h3>
                </CardHeader>
                <CardBody className="p-0">
                  {recentBookings.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-8">No bookings yet</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {recentBookings.map(b => (
                        <li key={b.id}>
                          <Link
                            href={`/dashboard/bookings/${b.bookingRef}`}
                            className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900">{b.bookingRef}</span>
                                <StatusBadge status={b.status} />
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {b.passengers[0]?.name ?? b.agent ?? '—'} · {formatDate(b.arrivalDate)}
                              </p>
                            </div>
                            <div className="text-slate-400">
                              <ArrowRight className="w-4 h-4" />
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              {/* Booking status breakdown */}
              <Card>
                <CardHeader>
                  <h3 className="text-base font-semibold text-slate-900">Bookings by Status</h3>
                </CardHeader>
                <CardBody>
                  {stats?.byStatus && Object.keys(stats.byStatus).length > 0 ? (
                    <div className="space-y-3">
                      {Object.entries(stats.byStatus)
                        .sort((a, b) => b[1] - a[1])
                        .map(([status, count]) => (
                          <div key={status} className="flex items-center gap-3">
                            <StatusBadge status={status as BookingStatus} />
                            <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div
                                className="h-full bg-brand-500 rounded-full transition-all"
                                style={{ width: `${(count / (stats?.totalBookings || 1)) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-slate-700 w-6 text-right">{count}</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-center text-slate-400 text-sm py-8">No data yet</p>
                  )}
                </CardBody>
              </Card>
            </div>

            {/* Quick actions by role */}
            <Card>
              <CardHeader>
                <h3 className="text-base font-semibold text-slate-900">Quick Actions</h3>
              </CardHeader>
              <CardBody>
                <div className="flex flex-wrap gap-3">
                  {(role === 'BT_USER' || role === 'SUPER_ADMIN') && (
                    <Link href="/dashboard/bookings/new" className="btn-primary btn text-sm">
                      <FileText className="w-4 h-4" /> New Booking
                    </Link>
                  )}
                  {(role === 'GT_USER' || role === 'SUPER_ADMIN') && (
                    <Link href="/dashboard/ground/review" className="btn-secondary btn text-sm">
                      <CheckCircle2 className="w-4 h-4" /> Review Queue
                    </Link>
                  )}
                  {(role === 'AC_USER' || role === 'SUPER_ADMIN') && (
                    <Link href="/dashboard/accounts/pnl" className="btn-secondary btn text-sm">
                      <TrendingUp className="w-4 h-4" /> Manage P&amp;L
                    </Link>
                  )}
                  {(role === 'TE_USER' || role === 'SUPER_ADMIN') && (
                    <Link href="/dashboard/te/reminders" className="btn-secondary btn text-sm">
                      <AlertCircle className="w-4 h-4" /> Reminders
                    </Link>
                  )}
                  {role === 'SUPER_ADMIN' && (
                    <Link href="/dashboard/admin/users" className="btn-secondary btn text-sm">
                      <Users className="w-4 h-4" /> Manage Users
                    </Link>
                  )}
                </div>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
