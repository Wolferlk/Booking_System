'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  FileText, Clock, AlertCircle, CreditCard, TrendingUp,
  Globe, Users, Loader2, ArrowRight, CheckCircle2, Lock,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, StatCard, CardHeader, CardBody } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Link from 'next/link'
import type { UserRole, BookingStatus } from '@prisma/client'

const COUNTRY_META: Record<string, {
  name: string; flag: string; code: string
  gradient: string; border: string; text: string; badge: string
}> = {
  VIETNAM: {
    name: 'Vietnam', flag: '🇻🇳', code: 'MMT_VN',
    gradient: 'from-red-500/10 to-red-600/5',
    border: 'border-red-500/20',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700 border-red-200',
  },
  SRILANKA: {
    name: 'Sri Lanka', flag: '🇱🇰', code: 'MMT_LK',
    gradient: 'from-yellow-500/10 to-yellow-600/5',
    border: 'border-yellow-500/20',
    text: 'text-yellow-700',
    badge: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  SINGAPORE_MALAYSIA: {
    name: 'Singapore & Malaysia', flag: '🇸🇬🇲🇾', code: 'MMT_SG_MY',
    gradient: 'from-blue-500/10 to-blue-600/5',
    border: 'border-blue-500/20',
    text: 'text-blue-700',
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
  },
}

const ROLE_LABELS: Record<string, string> = {
  BT_USER:           'Booking Team',
  GT_USER:           'Ground Team',
  TE_USER:           'Travel Experience Team',
  GT_TE_USER:        'Ground & Travel Experience',
  AC_USER:           'Accounts Team',
  SUPER_ADMIN:       'Country Admin',
  ULTRA_SUPER_ADMIN: 'Ultra Super Admin',
}

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
  operationCountry: string | null
  passengers: { name: string }[]
  createdBy: { name: string }
}

export default function DashboardPage() {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const { countryFilter, canFilter } = useCountryFilter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const cqs = countryFilter && countryFilter !== 'ALL' ? `country=${countryFilter}` : ''
        const [statsRes, bookingsRes] = await Promise.all([
          fetch(`/api/dashboard/stats${cqs ? `?${cqs}` : ''}`),
          fetch(`/api/bookings?limit=5${cqs ? `&${cqs}` : ''}`),
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
  }, [countryFilter])

  const isAdmin = role === 'SUPER_ADMIN'
  const isAccounts = role === 'AC_USER'
  const countryMeta = countryFilter && countryFilter !== 'ALL' ? COUNTRY_META[countryFilter] : null

  return (
    <div>
      <Header
        title={`Welcome back, ${session?.user?.name?.split(' ')[0]} 👋`}
        subtitle={
          countryMeta
            ? `${countryMeta.flag} ${ROLE_LABELS[role ?? ''] ?? role} · ${countryMeta.name} Operations`
            : "Here's what's happening with your bookings today"
        }
      />

      <div className="p-8 space-y-8">
        {/* Country context banner */}
        {countryMeta && (
          <div className={`flex items-center gap-4 px-6 py-5 rounded-2xl border bg-gradient-to-r ${countryMeta.gradient} ${countryMeta.border}`}>
            <span className="text-5xl leading-none flex-shrink-0">{countryMeta.flag}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Operating Region</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5 leading-tight">{countryMeta.name}</p>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{countryMeta.code}</p>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              {!canFilter ? (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white/70 backdrop-blur-sm px-3 py-1.5 rounded-full border border-slate-200/80">
                  <Lock className="w-3 h-3" /> Country Locked
                </div>
              ) : (
                <div className="text-xs font-semibold text-slate-500 bg-white/60 px-3 py-1.5 rounded-full border border-slate-200/80">
                  Filtered to {countryMeta.name}
                </div>
              )}
              <p className="text-[10px] text-slate-400">All stats &amp; bookings shown below are for this region</p>
            </div>
          </div>
        )}

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
                  <h3 className="text-base font-semibold text-slate-900">
                    {countryMeta ? (
                      <>
                        <span className="mr-1.5">{countryMeta.flag}</span>
                        Recent {countryMeta.name} Bookings
                      </>
                    ) : 'Recent Bookings'}
                  </h3>
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
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-slate-900">{b.bookingRef}</span>
                                <StatusBadge status={b.status} />
                                {!countryMeta && b.operationCountry && COUNTRY_META[b.operationCountry] && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${COUNTRY_META[b.operationCountry].badge}`}>
                                    {COUNTRY_META[b.operationCountry].flag} {COUNTRY_META[b.operationCountry].code}
                                  </span>
                                )}
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
