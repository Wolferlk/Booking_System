'use client'

/**
 * Partner Performance — the league table across every driver, vehicle vendor,
 * guide and tour vendor, and the drill-down into one partner's full record.
 *
 * Read-only end to end: both APIs behind this page are GET-only aggregates over
 * assignments and the feedback tables. Nothing on this screen writes.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  Loader2, Search, Star, Trophy, AlertTriangle, ThumbsUp, Users, Route,
  TrendingUp, X, Car, Truck, Sparkles, Store, Medal, Filter, ArrowUpDown,
  ShieldAlert, Clock, BarChart3,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { CountryFlag } from '@/components/ui/country-flag'
import PartnerPerformance from '@/components/ground/partner-performance'
import { useCountryFilter } from '@/hooks/use-country-filter'
import { cn, formatDate } from '@/lib/utils'

type PartnerKind = 'driver' | 'vendor' | 'guide' | 'tourVendor'
type Grade = 'A+' | 'A' | 'B' | 'C' | 'D'

interface LeaderRow {
  kind: PartnerKind
  id: string
  name: string
  phone: string | null
  photoUrl: string | null
  country: string | null
  isActive: boolean
  vendorName?: string | null
  vehicle?: string | null
  fleetSize?: number
  driverCount?: number
  trips: number
  bookings: number
  trips90d: number
  lastTrip: string | null
  rating: number | null
  ratedBookings: number
  praiseCount: number
  complaintCount: number
  score: number | null
  grade: Grade | null
}

const KINDS: { key: PartnerKind; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'driver',     label: 'Drivers',      icon: Car },
  { key: 'vendor',     label: 'Vendors',      icon: Truck },
  { key: 'guide',      label: 'Guides',       icon: Sparkles },
  { key: 'tourVendor', label: 'Tour Vendors', icon: Store },
]

const GRADE_CHIP: Record<Grade, string> = {
  'A+': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  A:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  B:    'bg-blue-50 text-blue-700 border-blue-200',
  C:    'bg-amber-50 text-amber-700 border-amber-200',
  D:    'bg-red-50 text-red-700 border-red-200',
}

const WINDOWS = [
  { key: '12', label: 'Last 12 months' },
  { key: '24', label: 'Last 24 months' },
  { key: 'all', label: 'All time' },
]

type SortKey = 'score' | 'rating' | 'trips' | 'complaints' | 'recent' | 'name'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score',      label: 'Overall score' },
  { key: 'rating',     label: 'Guest rating' },
  { key: 'trips',      label: 'Workload' },
  { key: 'complaints', label: 'Most complaints' },
  { key: 'recent',     label: 'Recently active' },
  { key: 'name',       label: 'Name' },
]

type Lens = 'all' | 'rated' | 'flagged' | 'idle' | 'unused'

function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[11px] text-slate-300 italic">unrated</span>
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={cn(
            'w-3 h-3',
            value >= i - 0.25 ? 'text-amber-400 fill-amber-400'
              : value >= i - 0.75 ? 'text-amber-400 fill-amber-200'
              : 'text-slate-200 fill-slate-200',
          )}
        />
      ))}
    </span>
  )
}

export default function PartnerAnalyticsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { countryFilter } = useCountryFilter()

  // Rates are internal. Only the roles that already see them elsewhere in the
  // Ground module get the cost block in the drill-down.
  const canSeeRates = ['GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
    .includes(session?.user?.role ?? '')

  const [kind, setKind]     = useState<PartnerKind>('driver')
  const [months, setMonths] = useState('24')
  const [rows, setRows]     = useState<LeaderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState<SortKey>('score')
  const [lens, setLens]     = useState<Lens>('all')
  const [selected, setSelected] = useState<LeaderRow | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ kind, months })
    if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
    fetch(`/api/ground/analytics/leaderboard?${params}`)
      .then(r => r.json())
      .then(j => { if (!cancelled && j.success) setRows(j.data.rows) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [kind, months, countryFilter])

  // ── Fleet-level roll-up, computed from the same rows the table shows so the
  // headline numbers can never disagree with the list underneath them.
  const summary = useMemo(() => {
    const active = rows.filter(r => r.trips > 0)
    const rated = rows.filter(r => r.rating != null)
    return {
      total: rows.length,
      working: active.length,
      trips: rows.reduce((s, r) => s + r.trips, 0),
      bookings: rows.reduce((s, r) => s + r.bookings, 0),
      avgRating: rated.length
        ? Math.round((rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length) * 100) / 100
        : null,
      ratedShare: rows.length ? Math.round((rated.length / rows.length) * 100) : 0,
      complaints: rows.reduce((s, r) => s + r.complaintCount, 0),
      praise: rows.reduce((s, r) => s + r.praiseCount, 0),
      flagged: rows.filter(r => r.complaintCount > 0).length,
      idle: active.filter(r => r.trips90d === 0).length,
      unused: rows.filter(r => r.trips === 0).length,
    }
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows.filter(r => {
      if (q && !`${r.name} ${r.phone ?? ''} ${r.vendorName ?? ''} ${r.vehicle ?? ''}`.toLowerCase().includes(q)) return false
      switch (lens) {
        case 'rated':   return r.rating != null
        case 'flagged': return r.complaintCount > 0
        case 'idle':    return r.trips > 0 && r.trips90d === 0
        case 'unused':  return r.trips === 0
        default:        return true
      }
    })
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'rating':     return (b.rating ?? -1) - (a.rating ?? -1) || b.trips - a.trips
        case 'trips':      return b.trips - a.trips
        case 'complaints': return b.complaintCount - a.complaintCount || (a.rating ?? 5) - (b.rating ?? 5)
        case 'recent':     return (b.lastTrip ?? '').localeCompare(a.lastTrip ?? '')
        case 'name':       return a.name.localeCompare(b.name)
        default:           return (b.score ?? -1) - (a.score ?? -1) || b.trips - a.trips
      }
    })
    return list
  }, [rows, search, sort, lens])

  // The podium only ever shows partners with enough work behind them to mean
  // something — one five-star trip should not beat a hundred good ones.
  const podium = useMemo(
    () => rows.filter(r => r.rating != null && r.trips >= 3).slice(0, 3),
    [rows],
  )
  const watchlist = useMemo(
    () => rows.filter(r => r.complaintCount > 0)
      .sort((a, b) => b.complaintCount - a.complaintCount || (a.rating ?? 5) - (b.rating ?? 5))
      .slice(0, 5),
    [rows],
  )

  const kindLabel = KINDS.find(k => k.key === kind)?.label ?? 'Partners'

  return (
    <div>
      <Header
        title="Partner Performance"
        subtitle="Workload, guest ratings, praise and complaints for every driver, vendor and guide"
      />

      <div className="p-4 sm:p-8 space-y-5">
        {/* ── Kind tabs + window ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {KINDS.map(k => {
              const Icon = k.icon
              return (
                <button
                  key={k.key}
                  onClick={() => { setKind(k.key); setSelected(null) }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors',
                    kind === k.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />{k.label}
                </button>
              )
            })}
          </div>

          <select
            value={months}
            onChange={e => setMonths(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
          >
            {WINDOWS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>

          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Ratings and complaints are counted inside this window
          </span>
        </div>

        {/* ── Fleet roll-up ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />{kindLabel}
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{summary.total}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{summary.working} with movements on record</p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              <Route className="w-3.5 h-3.5" />Movements
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{summary.trips.toLocaleString()}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">across {summary.bookings.toLocaleString()} files</p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5" />Average rating
            </p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-2xl font-bold text-slate-900">{summary.avgRating?.toFixed(2) ?? '—'}</p>
              <Stars value={summary.avgRating} />
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">{summary.ratedShare}% of {kindLabel.toLowerCase()} rated</p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              <ThumbsUp className="w-3.5 h-3.5" />Praise
            </p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{summary.praise}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">written compliments received</p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />Complaints
            </p>
            <p className={cn('text-2xl font-bold mt-1', summary.complaints > 0 ? 'text-red-600' : 'text-slate-900')}>
              {summary.complaints}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">on {summary.flagged} {kindLabel.toLowerCase()}</p>
          </Card>
        </div>

        {/* ── Podium + watchlist ─────────────────────────────────────────── */}
        {!loading && (podium.length > 0 || watchlist.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="lg:col-span-2 p-4">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-amber-500" />Top rated
                <span className="text-[11px] font-normal text-slate-400">· 3+ movements, guest-rated</span>
              </h3>
              {podium.length === 0 ? (
                <p className="text-xs text-slate-400 py-4">Nobody has enough rated work yet to rank.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {podium.map((r, i) => (
                    <button
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className={cn(
                        'text-left rounded-xl border p-3 transition-shadow hover:shadow-card-hover',
                        i === 0 ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-white'
                          : i === 1 ? 'border-slate-300 bg-gradient-to-br from-slate-50 to-white'
                          : 'border-orange-200 bg-gradient-to-br from-orange-50 to-white',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Medal className={cn('w-4 h-4', i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : 'text-orange-400')} />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">#{i + 1}</span>
                        {r.grade && (
                          <span className={cn('ml-auto px-1.5 py-0.5 rounded border text-[10px] font-bold', GRADE_CHIP[r.grade])}>
                            {r.grade}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-900 truncate">{r.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Stars value={r.rating} />
                        <span className="text-xs font-bold text-slate-700 tabular-nums">{r.rating?.toFixed(2)}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {r.trips} movements · {r.ratedBookings} rated file{r.ratedBookings === 1 ? '' : 's'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
                <ShieldAlert className="w-4 h-4 text-red-500" />Needs attention
              </h3>
              {watchlist.length === 0 ? (
                <p className="text-xs text-slate-400 py-4">No complaints on record. Clean sheet across the board.</p>
              ) : (
                <div className="space-y-1.5">
                  {watchlist.map(r => (
                    <button
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="w-full text-left rounded-lg border border-red-100 bg-red-50/50 px-3 py-2 hover:bg-red-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800 truncate">{r.name}</span>
                        <span className="text-[11px] font-bold text-red-600 flex items-center gap-1 flex-shrink-0">
                          <AlertTriangle className="w-3 h-3" />{r.complaintCount}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {r.rating != null ? `${r.rating.toFixed(2)}★ · ` : ''}{r.trips} movements
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${kindLabel.toLowerCase()}…`}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
              {([
                ['all', `All ${rows.length}`],
                ['rated', 'Rated'],
                ['flagged', `Flagged ${summary.flagged}`],
                ['idle', `Idle ${summary.idle}`],
                ['unused', `Never used ${summary.unused}`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setLens(key)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
                    lens === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                className="px-2 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
              >
                {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
        </Card>

        {/* ── League table ───────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="p-16 text-center">
            <Filter className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400">Nothing matches this filter.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="text-left px-4 py-2.5 w-10">#</th>
                    <th className="text-left px-4 py-2.5">{kindLabel.replace(/s$/, '')}</th>
                    <th className="text-left px-4 py-2.5">Rating</th>
                    <th className="text-right px-4 py-2.5">Movements</th>
                    <th className="text-right px-4 py-2.5">Files</th>
                    <th className="text-center px-4 py-2.5">Feedback</th>
                    <th className="text-left px-4 py-2.5">Last trip</th>
                    <th className="text-right px-4 py-2.5">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r, i) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="hover:bg-brand-50/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2.5 text-xs font-bold text-slate-300 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {r.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                              <Users className="w-4 h-4 text-slate-400" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 truncate">{r.name}</span>
                              {r.country && <CountryFlag country={r.country} className="w-4 h-3 flex-shrink-0" />}
                              {!r.isActive && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold">Inactive</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 truncate">
                              {[r.vendorName, r.vehicle, r.phone].filter(Boolean).join(' · ')
                                || (r.fleetSize != null ? `${r.fleetSize} vehicles · ${r.driverCount} drivers` : '')}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Stars value={r.rating} />
                          {r.rating != null && (
                            <span className="text-xs font-bold text-slate-700 tabular-nums">{r.rating.toFixed(2)}</span>
                          )}
                        </div>
                        {r.ratedBookings > 0 && (
                          <p className="text-[10px] text-slate-400 mt-0.5">{r.ratedBookings} rated file{r.ratedBookings === 1 ? '' : 's'}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="font-bold text-slate-900 tabular-nums">{r.trips}</span>
                        {r.trips90d > 0 && (
                          <p className="text-[10px] text-emerald-600 font-semibold">{r.trips90d} in 90d</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.bookings}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {r.praiseCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold flex items-center gap-0.5">
                              <ThumbsUp className="w-2.5 h-2.5" />{r.praiseCount}
                            </span>
                          )}
                          {r.complaintCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[10px] font-bold flex items-center gap-0.5">
                              <AlertTriangle className="w-2.5 h-2.5" />{r.complaintCount}
                            </span>
                          )}
                          {r.praiseCount === 0 && r.complaintCount === 0 && (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {r.lastTrip ? formatDate(r.lastTrip) : <span className="text-slate-300">never</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.score != null ? (
                          <span className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-bold', r.grade ? GRADE_CHIP[r.grade] : '')}>
                            {r.score}<span className="opacity-60">{r.grade}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <p className="text-[11px] text-slate-400 leading-relaxed max-w-3xl">
          <BarChart3 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          The score blends the guest rating (60), how much work the partner has actually done (20), whether they
          are still driving for us (10) and a clean complaint record (10). A partner nobody has rated is scored on
          workload and recency only, and is marked <em>unrated</em> rather than ranked as if the rating were real.
        </p>
      </div>

      {/* ── Drill-down ───────────────────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-3xl bg-slate-50 h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200 px-5 py-4 flex items-start gap-3">
              {selected.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.photoUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
              ) : (
                <span className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center">
                  <Users className="w-5 h-5 text-slate-400" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 truncate">{selected.name}</h2>
                  {selected.country && <CountryFlag country={selected.country} />}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {[selected.vendorName, selected.vehicle, selected.phone].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 sm:p-5">
              <PartnerPerformance
                kind={selected.kind}
                id={selected.id}
                showValue={canSeeRates}
                onOpenBooking={ref => router.push(`/dashboard/bookings/${ref}`)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
