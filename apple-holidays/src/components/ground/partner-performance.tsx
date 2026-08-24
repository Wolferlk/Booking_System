'use client'

/**
 * Performance panel for one ground partner — a driver, a vehicle vendor, a
 * guide or a tour vendor.
 *
 * Purely a reader: it calls GET /api/ground/analytics/partner and renders. It
 * is mounted inside the expanded driver row, the vendor drawer and the Partner
 * Performance page, so everything here has to survive being ~640px wide.
 */

import { useEffect, useState, useMemo } from 'react'
import {
  Loader2, Star, TrendingUp, AlertTriangle, ThumbsUp, MapPin, Users,
  CalendarDays, Route, Briefcase, Sparkles, MessageSquareQuote, Car,
  ShieldCheck, Clock, Wallet, Info, ChevronRight, PhoneCall, ClipboardList,
} from 'lucide-react'
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

// ── Types (mirrors src/lib/partner-analytics.ts) ─────────────────────────────

type PartnerKind = 'driver' | 'vendor' | 'guide' | 'tourVendor'
type CommentTone = 'praise' | 'complaint' | 'neutral'
type FeedbackRating = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR'

interface PartnerComment {
  bookingId: string
  bookingRef: string
  tone: CommentTone
  source: 'GUEST_FORM' | 'STAFF_FEEDBACK' | 'CALL_ALERT'
  text: string
  score: number | null
  driverRating: FeedbackRating | null
  mentionsDriver: boolean
  clientName: string | null
  date: string | null
  category?: string | null
  severity?: string | null
  status?: string | null
}

export interface PartnerAnalytics {
  kind: PartnerKind
  id: string
  trips: number
  bookings: number
  daysOnRoad: number
  pax: number
  upcomingTrips: number
  completedTrips: number
  cancelledBookings: number
  firstTrip: string | null
  lastTrip: string | null
  daysSinceLastTrip: number | null
  trips30d: number
  trips90d: number
  value: { currency: string; total: number; trips: number }[]
  monthly: { month: string; label: string; trips: number; bookings: number; pax: number }[]
  topRoutes: { label: string; count: number }[]
  topAgents: { label: string; count: number }[]
  countries: { country: string; count: number }[]
  vehicleTypes: { label: string; count: number }[]
  repeatAgents: number
  rating: number | null
  ratingBlended: number | null
  vehicleRating: number | null
  overallRating: number | null
  ratingBreakdown: Record<FeedbackRating, number>
  ratedBookings: number
  responseRate: number | null
  praiseCount: number
  complaintCount: number
  openAlerts: number
  comments: PartnerComment[]
  score: number | null
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | null
  alertsUnavailable: boolean
}

// ── Presentation constants ────────────────────────────────────────────────────

const GRADE_STYLE: Record<string, { ring: string; text: string; chip: string; label: string }> = {
  'A+': { ring: '#059669', text: 'text-emerald-600', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Outstanding' },
  A:    { ring: '#10b981', text: 'text-emerald-600', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Strong' },
  B:    { ring: '#3b82f6', text: 'text-blue-600',    chip: 'bg-blue-50 text-blue-700 border-blue-200',          label: 'Reliable' },
  C:    { ring: '#f59e0b', text: 'text-amber-600',   chip: 'bg-amber-50 text-amber-700 border-amber-200',       label: 'Watch' },
  D:    { ring: '#ef4444', text: 'text-red-600',     chip: 'bg-red-50 text-red-700 border-red-200',             label: 'At risk' },
}

const RATING_META: Record<FeedbackRating, { label: string; bar: string; text: string }> = {
  EXCELLENT: { label: 'Excellent', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  GOOD:      { label: 'Good',      bar: 'bg-lime-500',    text: 'text-lime-700' },
  AVERAGE:   { label: 'Average',   bar: 'bg-amber-400',   text: 'text-amber-700' },
  POOR:      { label: 'Poor',      bar: 'bg-red-500',     text: 'text-red-700' },
}

const TONE_STYLE: Record<CommentTone, { card: string; chip: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  praise:    { card: 'border-emerald-200 bg-emerald-50/60', chip: 'bg-emerald-100 text-emerald-700', icon: ThumbsUp,      label: 'Praise' },
  complaint: { card: 'border-red-200 bg-red-50/60',         chip: 'bg-red-100 text-red-700',         icon: AlertTriangle, label: 'Complaint' },
  neutral:   { card: 'border-slate-200 bg-slate-50/60',     chip: 'bg-slate-100 text-slate-600',     icon: MessageSquareQuote, label: 'Comment' },
}

const SOURCE_LABEL: Record<PartnerComment['source'], string> = {
  GUEST_FORM: 'Guest feedback form',
  STAFF_FEEDBACK: 'Staff-logged feedback',
  CALL_ALERT: 'Raised on a call',
}

const KIND_NOUN: Record<PartnerKind, { one: string; work: string }> = {
  driver:     { one: 'driver',      work: 'movements driven' },
  vendor:     { one: 'vendor',      work: 'movements supplied' },
  guide:      { one: 'guide',       work: 'movements guided' },
  tourVendor: { one: 'tour vendor', work: 'movements operated' },
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function ScoreRing({ score, grade, size = 104 }: { score: number | null; grade: string | null; size?: number }) {
  const stroke = 9
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score ?? 0))
  const style = grade ? GRADE_STYLE[grade] : null

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={style?.ring ?? '#cbd5e1'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (pct / 100) * circumference}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-2xl font-bold leading-none', style?.text ?? 'text-slate-400')}>
          {score ?? '—'}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-1">
          {grade ? `Grade ${grade}` : 'no data'}
        </span>
      </div>
    </div>
  )
}

function Stars({ value, size = 'sm' }: { value: number | null; size?: 'sm' | 'lg' }) {
  const dim = size === 'lg' ? 'w-5 h-5' : 'w-3.5 h-3.5'
  if (value == null) return <span className="text-xs text-slate-400 italic">not yet rated</span>
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={cn(
            dim,
            // Half-ish steps are rounded to the nearest star deliberately: the
            // exact figure is printed beside these, so the icons only have to
            // give the shape of the score at a glance.
            value >= i - 0.25 ? 'text-amber-400 fill-amber-400'
              : value >= i - 0.75 ? 'text-amber-400 fill-amber-200'
              : 'text-slate-200 fill-slate-200',
          )}
        />
      ))}
    </div>
  )
}

function Metric({
  icon: Icon, label, value, sub, tone = 'slate',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'slate' | 'emerald' | 'blue' | 'amber' | 'red' | 'violet'
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-500 bg-slate-100',
    emerald: 'text-emerald-600 bg-emerald-100',
    blue: 'text-blue-600 bg-blue-100',
    amber: 'text-amber-600 bg-amber-100',
    red: 'text-red-600 bg-red-100',
    violet: 'text-violet-600 bg-violet-100',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className={cn('p-1.5 rounded-lg', tones[tone])}><Icon className="w-3.5 h-3.5" /></span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-slate-900 leading-none">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
    </div>
  )
}

function Chip({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="absolute inset-y-0 left-0 bg-brand-50" style={{ width: `${pct}%` }} />
      <div className="relative flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-700 truncate">{label}</span>
        <span className="text-xs font-bold text-slate-900 tabular-nums">{count}</span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PartnerPerformance({
  kind,
  id,
  /** Show the internal cost figures. Off for anyone who should not see rates. */
  showValue = false,
  className,
  onOpenBooking,
}: {
  kind: PartnerKind
  id: string
  showValue?: boolean
  className?: string
  onOpenBooking?: (bookingRef: string) => void
}) {
  const [data, setData] = useState<PartnerAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'complaint' | 'praise'>('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/ground/analytics/partner?kind=${kind}&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (j.success) setData(j.data.analytics)
        else setError(j.error ?? 'Could not load performance')
      })
      .catch(() => { if (!cancelled) setError('Could not load performance') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [kind, id])

  const comments = useMemo(() => {
    if (!data) return []
    if (tab === 'all') return data.comments
    return data.comments.filter(c => c.tone === tab)
  }, [data, tab])

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-12 gap-2 text-slate-400', className)}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs font-medium">Building performance record…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={cn('rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800', className)}>
        {error ?? 'No performance data'}
      </div>
    )
  }

  const noun = KIND_NOUN[kind]
  const hasHistory = data.trips > 0
  const gradeStyle = data.grade ? GRADE_STYLE[data.grade] : null
  const breakdownTotal = (['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR'] as FeedbackRating[])
    .reduce((s, k) => s + data.ratingBreakdown[k], 0)
  const routeMax = data.topRoutes[0]?.count ?? 0
  const agentMax = data.topAgents[0]?.count ?? 0

  if (!hasHistory) {
    return (
      <div className={cn('rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center', className)}>
        <Route className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-600">No movements on record yet</p>
        <p className="text-xs text-slate-400 mt-1">
          This {noun.one} has never been allocated in the movement chart, so there is nothing to score.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* ── Scorecard ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <ScoreRing score={data.score} grade={data.grade} />

          <div className="flex-1 min-w-0 w-full">
            <div className="flex flex-wrap items-center gap-2">
              {gradeStyle && (
                <span className={cn('px-2 py-0.5 rounded-full border text-[11px] font-bold uppercase tracking-wide', gradeStyle.chip)}>
                  {gradeStyle.label}
                </span>
              )}
              {data.complaintCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{data.complaintCount} complaint{data.complaintCount > 1 ? 's' : ''}
                </span>
              )}
              {data.praiseCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1">
                  <ThumbsUp className="w-3 h-3" />{data.praiseCount} praise
                </span>
              )}
              {data.trips90d === 0 && (
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1">
                  <Clock className="w-3 h-3" />idle 90 days
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Guest rating</p>
                <div className="flex items-center gap-2 mt-1">
                  <Stars value={data.rating ?? data.overallRating} size="lg" />
                  <span className="text-lg font-bold text-slate-900 tabular-nums">
                    {(data.rating ?? data.overallRating)?.toFixed(2) ?? '—'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {data.rating != null
                    ? `${breakdownTotal} chauffeur score${breakdownTotal === 1 ? '' : 's'} from guests`
                    : data.overallRating != null
                      ? 'from overall trip scores — no chauffeur score yet'
                      : 'no guest feedback received yet'}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Feedback coverage</p>
                <p className="text-lg font-bold text-slate-900 mt-1 tabular-nums">
                  {data.responseRate != null ? `${data.responseRate}%` : '—'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {data.ratedBookings} of {Math.max(0, data.bookings - data.cancelledBookings)} completed files rated
                </p>
              </div>

              {data.vehicleRating != null && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Vehicle</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Stars value={data.vehicleRating} />
                    <span className="text-sm font-bold text-slate-900 tabular-nums">{data.vehicleRating.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Rating distribution */}
        {breakdownTotal > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR'] as FeedbackRating[]).map(key => {
              const n = data.ratingBreakdown[key]
              const pct = Math.round((n / breakdownTotal) * 100)
              const meta = RATING_META[key]
              return (
                <div key={key}>
                  <div className="flex items-baseline justify-between">
                    <span className={cn('text-[11px] font-semibold', meta.text)}>{meta.label}</span>
                    <span className="text-[11px] font-bold text-slate-700 tabular-nums">{n}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all duration-500', meta.bar)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Workload metrics ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Metric icon={Route} label="Movements" value={data.trips} sub={noun.work} tone="blue" />
        <Metric icon={Briefcase} label="Files" value={data.bookings} sub={`${data.repeatAgents} repeat agent${data.repeatAgents === 1 ? '' : 's'}`} tone="violet" />
        <Metric icon={CalendarDays} label="Days on road" value={data.daysOnRoad} sub={`${data.trips30d} in last 30d`} tone="emerald" />
        <Metric icon={Users} label="Guests carried" value={data.pax} sub="counted once per file" tone="amber" />
        <Metric
          icon={TrendingUp} label="Upcoming" value={data.upcomingTrips}
          sub={data.lastTrip ? `last drove ${formatDate(data.lastTrip)}` : 'never driven'}
          tone={data.upcomingTrips > 0 ? 'emerald' : 'slate'}
        />
        <Metric
          icon={ShieldCheck} label="Complaint rate"
          value={`${data.bookings > 0 ? Math.round((data.complaintCount / data.bookings) * 100) : 0}%`}
          sub={`${data.complaintCount} on ${data.bookings} files`}
          tone={data.complaintCount === 0 ? 'emerald' : data.complaintCount > 2 ? 'red' : 'amber'}
        />
      </div>

      {/* ── Activity trend ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-500" />Last 12 months
          </h4>
          <span className="text-[11px] text-slate-400">
            {data.firstTrip ? `on the road since ${formatDate(data.firstTrip)}` : ''}
          </span>
        </div>
        <div className="h-40 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.monthly} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pp-trips" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 16px rgba(15,23,42,0.08)' }}
                formatter={(value: number, name: string) => [value, name === 'trips' ? 'Movements' : name]}
              />
              <Area type="monotone" dataKey="trips" stroke="#f59e0b" strokeWidth={2} fill="url(#pp-trips)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Where they work ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data.topRoutes.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-brand-500" />Most-driven locations
            </h4>
            <div className="space-y-1.5">
              {data.topRoutes.slice(0, 6).map(r => <Chip key={r.label} label={r.label} count={r.count} max={routeMax} />)}
            </div>
          </div>
        )}
        {data.topAgents.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-brand-500" />Agents served
            </h4>
            <div className="space-y-1.5">
              {data.topAgents.map(a => <Chip key={a.label} label={a.label} count={a.count} max={agentMax} />)}
            </div>
            {data.vehicleTypes.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
                {data.vehicleTypes.map(v => (
                  <span key={v.label} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium capitalize flex items-center gap-1">
                    <Car className="w-3 h-3" />{v.label} · {v.count}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Internal cost ─────────────────────────────────────────────────── */}
      {showValue && data.value.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-brand-500" />Internal cost of these movements
          </h4>
          <div className="flex flex-wrap gap-2">
            {data.value.map(v => (
              <div key={v.currency} className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-base font-bold text-slate-900">{formatCurrency(v.total, v.currency)}</p>
                <p className="text-[11px] text-slate-400">{v.trips} rated movement{v.trips === 1 ? '' : 's'}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            Internal figure from the movement chart&apos;s driver rate. Never shared with the {noun.one}.
          </p>
        </div>
      )}

      {/* ── Comments ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <MessageSquareQuote className="w-4 h-4 text-brand-500" />What guests said
          </h4>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {([
              ['all', `All ${data.comments.length}`],
              ['complaint', `Complaints ${data.complaintCount}`],
              ['praise', `Praise ${data.praiseCount}`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                  tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {data.alertsUnavailable && (
          <p className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-px flex-shrink-0" />
            Call-desk complaint alerts are not available on this environment, so only the guest feedback forms are counted here.
          </p>
        )}

        {comments.length === 0 ? (
          <div className="py-8 text-center">
            <ClipboardList className="w-7 h-7 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400">
              {tab === 'complaint' ? 'No complaints on record — clean sheet.'
                : tab === 'praise' ? 'No written praise yet.'
                : `No guest feedback has been written on this ${noun.one}'s files yet.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {comments.map((c, i) => {
              const tone = TONE_STYLE[c.tone]
              const ToneIcon = tone.icon
              return (
                <div key={`${c.bookingId}-${c.source}-${i}`} className={cn('rounded-xl border p-3', tone.card)}>
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1', tone.chip)}>
                      <ToneIcon className="w-3 h-3" />{tone.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenBooking?.(c.bookingRef)}
                      className="font-mono text-[11px] font-bold text-slate-700 hover:text-brand-600 flex items-center gap-0.5"
                    >
                      {c.bookingRef}
                      {onOpenBooking && <ChevronRight className="w-3 h-3" />}
                    </button>
                    {c.driverRating && (
                      <span className={cn('text-[10px] font-semibold', RATING_META[c.driverRating].text)}>
                        chauffeur: {RATING_META[c.driverRating].label}
                      </span>
                    )}
                    {c.score != null && !c.driverRating && <Stars value={c.score} />}
                    {c.severity && (
                      <span className="text-[10px] font-semibold uppercase text-red-600">{c.severity}</span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-400">{c.date ? formatDate(c.date) : ''}</span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{c.text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      {c.source === 'CALL_ALERT' ? <PhoneCall className="w-3 h-3" /> : <MessageSquareQuote className="w-3 h-3" />}
                      {SOURCE_LABEL[c.source]}
                    </span>
                    {c.clientName && <span>· {c.clientName}</span>}
                    {c.mentionsDriver && <span className="text-brand-600 font-semibold">· names the {noun.one}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="mt-3 text-[10px] text-slate-400 leading-relaxed">
          Guests rate a whole file, not a single movement, so a score counts for every partner who worked that file.
          Where two drivers shared a booking, they share its rating.
        </p>
      </div>
    </div>
  )
}
