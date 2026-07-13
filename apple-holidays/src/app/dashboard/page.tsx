'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  FileText, AlertCircle, CreditCard, TrendingUp,
  Globe, Loader2, ArrowRight, Lock,
  Car, Ticket, ShieldCheck, Star, MessageSquare,
  Plane, MapPin, CalendarCheck, Phone, Bot, Building2,
  PhoneCall, Activity, Smile, Frown, Meh,
  ChevronRight, UserCheck, BarChart2,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, StatCard, CardHeader, CardBody } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Link from 'next/link'
import type { UserRole, BookingStatus } from '@prisma/client'
import { CountryFlag } from '@/components/ui/country-flag'

// ─── Country Meta ──────────────────────────────────────────────────────────────
const COUNTRY_META: Record<string, {
  name: string; code: string
  gradient: string; border: string; text: string; badge: string
}> = {
  VIETNAM: {
    name: 'Vietnam', code: 'MMT_VN',
    gradient: 'from-red-500/10 to-red-600/5',
    border: 'border-red-500/20',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700 border-red-200',
  },
  SRILANKA: {
    name: 'Sri Lanka', code: 'MMT_LK',
    gradient: 'from-yellow-500/10 to-yellow-600/5',
    border: 'border-yellow-500/20',
    text: 'text-yellow-700',
    badge: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  SINGAPORE: {
    name: 'Singapore', code: 'MMT_SG',
    gradient: 'from-blue-500/10 to-blue-600/5',
    border: 'border-blue-500/20',
    text: 'text-blue-700',
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  MALAYSIA: {
    name: 'Malaysia', code: 'MMT_MY',
    gradient: 'from-emerald-500/10 to-emerald-600/5',
    border: 'border-emerald-500/20',
    text: 'text-emerald-700',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  SINGAPORE_MALAYSIA: {
    name: 'Singapore & Malaysia', code: 'MMT_SG_MY',
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

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TodayArrivalBooking {
  bookingRef: string
  paxAdults: number
  paxChildren: number
  operationCountry: string | null
  passengers: { name: string }[]
}

interface TodayFlightItem {
  id: string
  flightNo: string | null
  airline: string | null
  depTime: string | null
  arrTime: string | null
  fromApt: string | null
  toApt: string | null
  booking: {
    bookingRef: string
    operationCountry: string | null
    paxAdults: number
    paxChildren: number
  }
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
  todayArrivals: number
  todayDepartures: number
  todayFlightsCount: number
  todayOperations: number
  todayArrivalsBookings: TodayArrivalBooking[]
  todayFlightsList: TodayFlightItem[]
}

interface RecentBooking {
  id: string
  bookingRef: string
  agent: string | null
  status: BookingStatus
  arrivalDate: string
  createdAt: string
  paxAdults: number
  paxChildren: number
  operationCountry: string | null
  passengers: { name: string }[]
  createdBy: { name: string }
}

interface TEJob {
  id: number
  name: string
  phone: string
  customer_name: string
  booking_ref?: string | null
  start_at: string
  last_run_at?: string | null
  runs: number
  status: 'scheduled' | 'paused' | 'done' | 'cancelled'
  last_result?: string | null
}

interface TEFeedback {
  id: number
  service_id: number
  booking_ref: string
  created_at: string
  sentiment?: string | null
  highlights?: string | null
  summary?: string | null
  hotel_ok?: string | null
  driver_ok?: string | null
  issues?: string | null
}

interface DriverItem { id: string; name: string; isActive: boolean }
interface VendorItem { id: string; name: string; country: string | null; drivers: unknown[]; vehicles: unknown[] }

// ─── TE Proxy helper ───────────────────────────────────────────────────────────
function teProxyFetch(path: string, params?: Record<string, string>) {
  const url = new URL('/api/te/proxy', window.location.origin)
  url.searchParams.set('path', path)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return fetch(url.toString()).then(r => r.json())
}

// ─── Format helpers ────────────────────────────────────────────────────────────
function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

// ─── Main Dashboard Page ───────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const { countryFilter, canFilter } = useCountryFilter()

  const [stats, setStats] = useState<Stats | null>(null)
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([])
  const [drivers, setDrivers] = useState<DriverItem[]>([])
  const [vendors, setVendors] = useState<VendorItem[]>([])
  const [aiJobs, setAiJobs] = useState<TEJob[] | null>(null)
  const [aiFeedbacks, setAiFeedbacks] = useState<TEFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [groundLoading, setGroundLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(true)

  const isAdmin    = role === 'SUPER_ADMIN' || role === 'ULTRA_SUPER_ADMIN'
  const isAccounts = role === 'AC_USER'
  const isGround   = role === 'GT_USER' || role === 'GT_TE_USER' || isAdmin
  const isTE       = role === 'TE_USER' || role === 'GT_TE_USER' || isAdmin

  const countryMeta = countryFilter && countryFilter !== 'ALL' ? COUNTRY_META[countryFilter] : null

  // ── Load core stats & recent bookings ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const cqs = countryFilter && countryFilter !== 'ALL' ? `country=${countryFilter}` : ''
        const [statsRes, bookingsRes] = await Promise.all([
          fetch(`/api/dashboard/stats${cqs ? `?${cqs}` : ''}`),
          fetch(`/api/bookings?limit=5&sortBy=createdAt&sortDir=desc${cqs ? `&${cqs}` : ''}`),
        ])
        const parseJson = async (res: Response) => {
          const text = await res.text()
          if (!text.trim()) throw new Error(`Empty response from ${res.url}`)
          try { return JSON.parse(text) as { success?: boolean; data?: unknown; error?: string }
          } catch { throw new Error(text.slice(0, 180)) }
        }
        const [statsJson, bookingsJson] = await Promise.all([parseJson(statsRes), parseJson(bookingsRes)])
        if (!statsRes.ok) throw new Error((statsJson.error as string) || `Stats ${statsRes.status}`)
        if (!bookingsRes.ok) throw new Error((bookingsJson.error as string) || `Bookings ${bookingsRes.status}`)
        if (statsJson.success) setStats(statsJson.data as Stats)
        if (bookingsJson.success) setRecentBookings((bookingsJson.data as { bookings: RecentBooking[] }).bookings)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Dashboard failed to load')
      } finally { setLoading(false) }
    }
    load()
  }, [countryFilter])

  // ── Load ground section ───────────────────────────────────────────────────────
  const loadGround = useCallback(async () => {
    if (!isGround) { setGroundLoading(false); return }
    try {
      const cqs = countryFilter && countryFilter !== 'ALL' ? `?country=${countryFilter}` : ''
      const [driversRes, vendorsRes] = await Promise.all([
        fetch(`/api/ground/drivers${cqs}`),
        fetch(`/api/ground/vendors${cqs}`),
      ])
      const [dJson, vJson] = await Promise.all([driversRes.json(), vendorsRes.json()])
      if (dJson.success) setDrivers(dJson.data as DriverItem[])
      if (vJson.success) setVendors(vJson.data as VendorItem[])
    } catch { /* fail silently */ } finally { setGroundLoading(false) }
  }, [countryFilter, isGround])

  // ── Load AI call bot section ──────────────────────────────────────────────────
  const loadAI = useCallback(async () => {
    if (!isTE) { setAiLoading(false); return }
    try {
      const jobsRes = await teProxyFetch('jobs', { limit: '50' })
      const jobs: TEJob[] = jobsRes.jobs ?? jobsRes.data ?? []
      setAiJobs(jobs)

      const svcRes = await teProxyFetch('services', { limit: '15' })
      const services: Array<{ id: number }> = svcRes.services ?? svcRes.data ?? []
      if (services.length > 0) {
        const fbResults = await Promise.allSettled(
          services.slice(0, 8).map(s => teProxyFetch('feedback', { serviceId: String(s.id) }))
        )
        const merged: TEFeedback[] = []
        fbResults.forEach(r => {
          if (r.status === 'fulfilled') merged.push(...((r.value.feedback ?? r.value.data ?? []) as TEFeedback[]))
        })
        merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setAiFeedbacks(merged.slice(0, 6))
      }
    } catch { /* fail silently */ } finally { setAiLoading(false) }
  }, [isTE])

  useEffect(() => { loadGround() }, [loadGround])
  useEffect(() => { loadAI() },    [loadAI])

  return (
    <div>
      <Header
        title={`Welcome back, ${session?.user?.name?.split(' ')[0]} 👋`}
        subtitle={
          countryMeta
            ? <span className="inline-flex items-center gap-1.5">
                <CountryFlag country={countryFilter} className="text-base leading-none" />
                {ROLE_LABELS[role ?? ''] ?? role} · {countryMeta.name} Operations
              </span>
            : "Here's what's happening with your bookings today"
        }
      />

      <div className="p-8 space-y-8">
        {/* Country context banner */}
        {countryMeta && (
          <div className={`flex items-center gap-4 px-6 py-5 rounded-2xl border bg-gradient-to-r ${countryMeta.gradient} ${countryMeta.border}`}>
            <CountryFlag country={countryFilter} className="w-5 h-4" />
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
            {/* ── Stats grid ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <StatCard
                label="Total Bookings"
                value={stats?.totalBookings ?? 0}
                icon={<FileText className="w-5 h-5" />}
                color="blue"
              />
              <StatCard
                label="Today Arrivals"
                value={stats?.todayArrivals ?? 0}
                icon={<MapPin className="w-5 h-5" />}
                color={(stats?.todayArrivals ?? 0) > 0 ? 'green' : 'blue'}
              />
              <StatCard
                label="Today Flights"
                value={stats?.todayFlightsCount ?? 0}
                icon={<Plane className="w-5 h-5" />}
                color={(stats?.todayFlightsCount ?? 0) > 0 ? 'purple' : 'blue'}
              />
              <StatCard
                label="Upcoming Trips (7d)"
                value={stats?.upcomingTrips ?? 0}
                icon={<Globe className="w-5 h-5" />}
                color="orange"
              />
            </div>

            {/* ── Financial row (Admin + Accounts) ──────────────────────────── */}
            {/* {(isAdmin || isAccounts) && (
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
            )} */}

            {/* ── Awaiting payment alert ─────────────────────────────────────── */}
            {(stats?.awaitingPayment ?? 0) > 0 && (
              <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <p className="text-sm font-medium text-amber-800">
                  <span className="font-bold">{stats?.awaitingPayment}</span> booking(s) awaiting payment confirmation
                </p>
                <Link
                  href="/dashboard/bookings?status=AWAITING_PAYMENT_CONFIRM"
                  className="ml-auto text-xs text-amber-700 hover:text-amber-900 font-semibold flex items-center gap-1"
                >
                  View <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            )}

            {/* ── Two-column: Recent Bookings + Bookings by Status ───────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RecentBookingsCard
                recentBookings={recentBookings}
                countryFilter={countryFilter}
                countryMeta={countryMeta}
              />
              <BookingsByStatus byStatus={stats?.byStatus ?? {}} totalBookings={stats?.totalBookings ?? 0} />
            </div>

            {/* ── Today's Operations ─────────────────────────────────────────── */}
            {((stats?.todayArrivals ?? 0) > 0 || (stats?.todayFlightsCount ?? 0) > 0) && (
              <TodayOperationsSection
                arrivalsBookings={stats?.todayArrivalsBookings ?? []}
                flightsList={stats?.todayFlightsList ?? []}
                todayDepartures={stats?.todayDepartures ?? 0}
              />
            )}

            {/* ── Ground & AI sections ───────────────────────────────────────── */}
            {(isGround || isTE) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {isGround && (
                  <GroundSummaryCard
                    drivers={drivers}
                    vendors={vendors}
                    loading={groundLoading}
                  />
                )}
                {isTE && (
                  <AICallBotAnalyticsCard
                    jobs={aiJobs}
                    loading={aiLoading}
                  />
                )}
              </div>
            )}

            {/* ── AI Latest Feedbacks ────────────────────────────────────────── */}
            {isTE && aiFeedbacks.length > 0 && (
              <AIFeedbacksCard feedbacks={aiFeedbacks} loading={aiLoading} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Recent Bookings Card ──────────────────────────────────────────────────────
function RecentBookingsCard({
  recentBookings,
  countryFilter,
  countryMeta,
}: {
  recentBookings: RecentBooking[]
  countryFilter: string
  countryMeta: typeof COUNTRY_META[string] | null
}) {
  return (
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
            <span className="inline-flex items-center gap-1.5">
              <CountryFlag country={countryFilter} className="w-5 h-4" />
              Recent {countryMeta.name} Bookings
            </span>
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
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{b.bookingRef}</span>
                      {!countryMeta && b.operationCountry && COUNTRY_META[b.operationCountry] && (
                        <CountryFlag country={b.operationCountry} className="w-4 h-3 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {b.passengers[0]?.name ?? b.agent ?? '—'} · {fmtShortDate(b.createdAt)}
                    </p>
                  </div>
                  <div className="text-slate-300 group-hover:text-slate-500 transition-colors">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

// ─── Bookings by Status ────────────────────────────────────────────────────────
const PIPELINE_STATUSES: {
  status: BookingStatus
  label: string
  icon: React.ReactNode
  bar: string
  badge: string
  dot: string
}[] = [
  {
    status:  'GT_REVIEW',
    label:   'Need Review',
    icon:    <AlertCircle className="w-3.5 h-3.5" />,
    bar:     'bg-amber-400',
    badge:   'bg-amber-100 text-amber-800 border border-amber-200',
    dot:     'bg-amber-400',
  },
  {
    status:  'DRIVER_ALLOCATED',
    label:   'Driver Allocated',
    icon:    <Car className="w-3.5 h-3.5" />,
    bar:     'bg-sky-500',
    badge:   'bg-sky-100 text-sky-800 border border-sky-200',
    dot:     'bg-sky-500',
  },
  {
    status:  'TICKETS_ISSUED',
    label:   'Tickets Activated',
    icon:    <Ticket className="w-3.5 h-3.5" />,
    bar:     'bg-fuchsia-500',
    badge:   'bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200',
    dot:     'bg-fuchsia-500',
  },
  {
    status:  'QC1_PASS',
    label:   'QC1 Pass',
    icon:    <ShieldCheck className="w-3.5 h-3.5" />,
    bar:     'bg-violet-500',
    badge:   'bg-violet-100 text-violet-800 border border-violet-200',
    dot:     'bg-violet-500',
  },
  {
    status:  'FEEDBACK_DONE',
    label:   'Feedback',
    icon:    <MessageSquare className="w-3.5 h-3.5" />,
    bar:     'bg-lime-500',
    badge:   'bg-lime-100 text-lime-800 border border-lime-200',
    dot:     'bg-lime-500',
  },
  {
    status:  'COMPLETED',
    label:   'Completed',
    icon:    <Star className="w-3.5 h-3.5" />,
    bar:     'bg-emerald-500',
    badge:   'bg-emerald-100 text-emerald-800 border border-emerald-200',
    dot:     'bg-emerald-500',
  },
]

function BookingsByStatus({ byStatus, totalBookings }: { byStatus: Record<string, number>; totalBookings: number }) {
  const shownCounts = PIPELINE_STATUSES.map(p => byStatus[p.status] ?? 0)
  const maxCount    = Math.max(...shownCounts, 1)
  const shownTotal  = shownCounts.reduce((a, b) => a + b, 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Bookings by Status</h3>
          <span className="text-xs text-slate-400 font-medium">{totalBookings.toLocaleString()} total</span>
        </div>
      </CardHeader>
      <CardBody className="space-y-0 p-0">
        {PIPELINE_STATUSES.map((p, idx) => {
          const count   = byStatus[p.status] ?? 0
          const pct     = Math.round((count / maxCount) * 100)
          const ofTotal = totalBookings > 0 ? Math.round((count / totalBookings) * 100) : 0

          return (
            <Link
              key={p.status}
              href={`/dashboard/bookings?status=${p.status}`}
              className={`flex items-center gap-3 px-5 py-3 group hover:bg-slate-50 transition-colors ${
                idx < PIPELINE_STATUSES.length - 1 ? 'border-b border-slate-100' : ''
              }`}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.dot}`} />
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.badge} flex-shrink-0`}>
                {p.icon}{p.label}
              </span>

              <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${count > 0 ? p.bar : 'bg-slate-200'}`}
                  style={{ width: count > 0 ? `${Math.max(pct, 2)}%` : '0%' }}
                />
              </div>

              <span className={`text-sm font-bold tabular-nums w-10 text-right flex-shrink-0 ${count > 0 ? 'text-slate-700' : 'text-slate-300'}`}>
                {count > 0 ? `${ofTotal}%` : '—'}
              </span>

              <span className="text-[10px] font-semibold text-brand-600 group-hover:text-brand-800 flex items-center gap-0.5 flex-shrink-0 transition-colors">
                View <ChevronRight className="w-3 h-3" />
              </span>
            </Link>
          )
        })}

        <div className="px-5 py-3 bg-slate-50 rounded-b-xl border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {shownTotal.toLocaleString()} of {totalBookings.toLocaleString()} bookings tracked
          </span>
          <Link
            href="/dashboard/bookings"
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </CardBody>
    </Card>
  )
}

// ─── Today's Operations Section ────────────────────────────────────────────────
function TodayOperationsSection({
  arrivalsBookings,
  flightsList,
  todayDepartures,
}: {
  arrivalsBookings: TodayArrivalBooking[]
  flightsList: TodayFlightItem[]
  todayDepartures: number
}) {
  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Today&apos;s Operations</h2>
        </div>
        <span className="text-xs text-slate-400 font-medium">{todayLabel}</span>
        {todayDepartures > 0 && (
          <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
            {todayDepartures} departing
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today Arrivals */}
        <Card>
          <CardHeader
            action={
              <Link href="/dashboard/bookings?dateFilter=arrivalToday" className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1">
                All <ArrowRight className="w-3 h-3" />
              </Link>
            }
          >
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-emerald-500" />
              Today&apos;s Arrivals
              {arrivalsBookings.length > 0 && (
                <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{arrivalsBookings.length}</span>
              )}
            </h3>
          </CardHeader>
          <CardBody className="p-0">
            {arrivalsBookings.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">No arrivals today</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {arrivalsBookings.map(b => (
                  <li key={b.bookingRef}>
                    <Link
                      href={`/dashboard/bookings/${b.bookingRef}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group"
                    >
                      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900">{b.bookingRef}</span>
                          {b.operationCountry && COUNTRY_META[b.operationCountry] && (
                            <CountryFlag country={b.operationCountry} className="w-4 h-3" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {b.passengers[0]?.name ?? '—'} · {b.paxAdults + b.paxChildren} pax
                        </p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Today Flights */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Plane className="w-4 h-4 text-violet-500" />
              Today&apos;s Flights
              {flightsList.length > 0 && (
                <span className="text-xs font-bold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">{flightsList.length}</span>
              )}
            </h3>
          </CardHeader>
          <CardBody className="p-0">
            {flightsList.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">No flights today</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {flightsList.map(f => (
                  <li key={f.id}>
                    <Link
                      href={`/dashboard/bookings/${f.booking.bookingRef}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group"
                    >
                      <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                        <Plane className="w-4 h-4 text-violet-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-900">{f.flightNo ?? '—'}</span>
                          <span className="text-xs text-slate-500">{f.fromApt} → {f.toApt}</span>
                          {f.booking.operationCountry && COUNTRY_META[f.booking.operationCountry] && (
                            <CountryFlag country={f.booking.operationCountry} className="w-4 h-3" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {f.booking.bookingRef} · {fmtTime(f.depTime)} – {fmtTime(f.arrTime)}
                          {f.airline ? ` · ${f.airline}` : ''}
                        </p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

// ─── Ground Summary Card ───────────────────────────────────────────────────────
function GroundSummaryCard({
  drivers,
  vendors,
  loading,
}: {
  drivers: DriverItem[]
  vendors: VendorItem[]
  loading: boolean
}) {
  const activeDrivers   = drivers.filter(d => d.isActive).length
  const inactiveDrivers = drivers.length - activeDrivers
  const totalVehicles   = vendors.reduce((n, v) => n + v.vehicles.length, 0)

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex items-center gap-2">
            <Link href="/dashboard/ground/drivers" className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1">
              Drivers <ArrowRight className="w-3 h-3" />
            </Link>
            <Link href="/dashboard/ground/vendors" className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1">
              Vendors <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        }
      >
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Car className="w-4 h-4 text-sky-500" />
          Ground Resources
        </h3>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-sky-50 border border-sky-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <UserCheck className="w-4 h-4 text-sky-600" />
                  <span className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Drivers</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{drivers.length}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="text-emerald-600 font-semibold">{activeDrivers} active</span>
                  {inactiveDrivers > 0 && <span className="text-slate-400"> · {inactiveDrivers} inactive</span>}
                </p>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Vendors</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{vendors.length}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="text-amber-600 font-semibold">{totalVehicles} vehicles</span>
                </p>
              </div>
            </div>

            {/* Quick nav */}
            <div className="grid grid-cols-1 gap-2">
              <Link
                href="/dashboard/ground/assignments"
                className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors group"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Activity className="w-4 h-4 text-slate-400" />
                  View Assignments
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </Link>
              <Link
                href="/dashboard/ground/review"
                className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors group"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <ShieldCheck className="w-4 h-4 text-slate-400" />
                  Ground Review Queue
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </Link>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── AI Call Bot Analytics Card ────────────────────────────────────────────────
const JOB_STATUS_COLORS: Record<string, string> = {
  scheduled: 'text-blue-700 bg-blue-50 border-blue-200',
  paused:    'text-amber-700 bg-amber-50 border-amber-200',
  done:      'text-emerald-700 bg-emerald-50 border-emerald-200',
  cancelled: 'text-slate-500 bg-slate-50 border-slate-200',
}

function AICallBotAnalyticsCard({ jobs, loading }: { jobs: TEJob[] | null; loading: boolean }) {
  const scheduled = (jobs ?? []).filter(j => j.status === 'scheduled').length
  const done      = (jobs ?? []).filter(j => j.status === 'done').length
  const paused    = (jobs ?? []).filter(j => j.status === 'paused').length
  const recentJobs = (jobs ?? [])
    .filter(j => j.last_run_at)
    .sort((a, b) => new Date(b.last_run_at!).getTime() - new Date(a.last_run_at!).getTime())
    .slice(0, 4)

  return (
    <Card>
      <CardHeader
        action={
          <Link href="/dashboard/te/ai-call-bot" className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1">
            Open Bot <ArrowRight className="w-3 h-3" />
          </Link>
        }
      >
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-500" />
          AI Call Bot
        </h3>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : jobs === null ? (
          <p className="text-center text-slate-400 text-sm py-6">Unable to load call bot data</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 bg-blue-50 rounded-xl border border-blue-100">
                <PhoneCall className="w-4 h-4 text-blue-600 mx-auto mb-1" />
                <p className="text-xl font-bold text-slate-900">{scheduled}</p>
                <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">Scheduled</p>
              </div>
              <div className="text-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <Phone className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
                <p className="text-xl font-bold text-slate-900">{done}</p>
                <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Completed</p>
              </div>
              <div className="text-center p-3 bg-amber-50 rounded-xl border border-amber-100">
                <BarChart2 className="w-4 h-4 text-amber-600 mx-auto mb-1" />
                <p className="text-xl font-bold text-slate-900">{jobs.length}</p>
                <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Total Jobs</p>
              </div>
            </div>

            {recentJobs.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Recent Activity</p>
                <ul className="space-y-1.5">
                  {recentJobs.map(j => (
                    <li key={j.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                      <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-slate-700 truncate block">
                          {j.customer_name || j.name}
                          {j.booking_ref && <span className="text-slate-400 font-normal"> · {j.booking_ref}</span>}
                        </span>
                        {j.last_run_at && (
                          <span className="text-[10px] text-slate-400">{fmtShortDate(j.last_run_at)}</span>
                        )}
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${JOB_STATUS_COLORS[j.status] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                        {j.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── AI Feedbacks Card ─────────────────────────────────────────────────────────
const SENTIMENT_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  positive: { icon: <Smile className="w-3.5 h-3.5" />, label: 'Positive', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  happy:    { icon: <Smile className="w-3.5 h-3.5" />, label: 'Happy',    color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  neutral:  { icon: <Meh   className="w-3.5 h-3.5" />, label: 'Neutral',  color: 'text-slate-600 bg-slate-50 border-slate-200' },
  negative: { icon: <Frown className="w-3.5 h-3.5" />, label: 'Negative', color: 'text-red-700 bg-red-50 border-red-200' },
}

function AIFeedbacksCard({ feedbacks, loading }: { feedbacks: TEFeedback[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader
        action={
          <Link href="/dashboard/te/ai-call-bot" className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        }
      >
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-violet-500" />
          AI Call Bot — Latest Feedback
        </h3>
      </CardHeader>
      <CardBody className="p-0">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : feedbacks.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">No feedback received yet</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {feedbacks.map(fb => {
              const sent = fb.sentiment?.toLowerCase() ?? ''
              const sentCfg = SENTIMENT_CONFIG[sent]
              return (
                <li key={fb.id} className="px-6 py-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Link
                          href={`/dashboard/bookings/${fb.booking_ref}`}
                          className="text-sm font-bold text-slate-900 hover:text-brand-600 transition-colors"
                        >
                          {fb.booking_ref}
                        </Link>
                        {sentCfg && (
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${sentCfg.color}`}>
                            {sentCfg.icon}{sentCfg.label}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 ml-auto">{fmtShortDate(fb.created_at)}</span>
                      </div>
                      {fb.summary && (
                        <p className="text-xs text-slate-600 leading-relaxed">{fb.summary}</p>
                      )}
                      {!fb.summary && fb.highlights && (
                        <p className="text-xs text-slate-600 leading-relaxed">{fb.highlights}</p>
                      )}
                      {fb.issues && (
                        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 flex-shrink-0" />
                          {fb.issues}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {fb.hotel_ok  && <span className="text-[10px] text-slate-500">🏨 Hotel: {fb.hotel_ok}</span>}
                        {fb.driver_ok && <span className="text-[10px] text-slate-500">🚗 Driver: {fb.driver_ok}</span>}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
