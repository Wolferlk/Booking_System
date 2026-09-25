'use client'

/**
 * Live Ops Hero — the dashboard's opening answer to "what is happening now".
 *
 * The page below it is a book of records: totals, pipeline, recent files. None
 * of it is *live*, and none of it is the thing the first person through the door
 * each morning needs — how many guests are out there, in which towns, which
 * vehicles are carrying them, and which aircraft is about to land on top of the
 * day. This section is that, refreshed on its own timer and drawn on a map.
 *
 * Everything here reads from /api/dashboard/live-ops. Nothing here writes.
 * Country scope is not a decoration: a user locked to one country gets that
 * country's map, that country's flights and that country's fleet, because the
 * API scopes the rows before they ever reach the browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Users, Car, PlaneTakeoff, PlaneLanding, Plane, RefreshCw,
  MapPin, UserCheck, AlertTriangle, ArrowRight, Briefcase, Globe2, Clock,
} from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'
import type { VehicleKind } from '@/lib/ops-geo'
import { cn } from '@/lib/utils'
import type { LiveFlight, LiveOnGround } from '@/components/dashboard/live-ops-map'

// Leaflet touches `window` at import time, so the map can only ever be a client
// chunk — pulled in after paint so the hero's numbers are never waiting on it.
const LiveOpsMap = dynamic(() => import('@/components/dashboard/live-ops-map'), {
  ssr: false,
  loading: () => <div className="h-[360px] rounded-2xl bg-slate-100 border border-slate-200 animate-pulse" />,
})

// ─── Shape ────────────────────────────────────────────────────────────────

interface LiveOps {
  scope: string
  generatedAt: string
  nowMinutes: number
  totals: {
    paxOnGround: number; adultsOnGround: number; childrenOnGround: number
    bookingsOnGround: number; vehiclesOnGround: number; driversOnGround: number
    guidesOnGround: number; movementsToday: number; unassignedMovements: number
    arrivalsToday: number; departuresToday: number; flightsToday: number; airborneNow: number
  }
  countries: { country: string; label: string; pax: number; bookings: number; arrivals: number; departures: number; hex: string }[]
  fleet: { kind: VehicleKind; count: number }[]
  onGround: LiveOnGround[]
  flights: LiveFlight[]
}

/** Live data goes stale in minutes, not hours. */
const REFRESH_MS = 90_000

// ─── Count-up ─────────────────────────────────────────────────────────────

/**
 * Numbers that arrive by animating up from where they were.
 *
 * Not decoration: this hero re-fetches on a timer, and a figure that *moves*
 * when it changes is the only cue that something actually happened while the
 * operator was reading something else on the page.
 */
function useCountUp(target: number, ms = 900) {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number>()

  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      // Ease-out cubic: fast enough to feel responsive, settled enough to read.
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, ms])

  return value
}

function Counter({ value, className }: { value: number; className?: string }) {
  const shown = useCountUp(value)
  return <span className={className}>{shown.toLocaleString()}</span>
}

// ─── Hero ─────────────────────────────────────────────────────────────────

export default function LiveOpsHero({
  country,
  canFilter,
  userName,
}: {
  country: string
  canFilter: boolean
  userName?: string | null
}) {
  const [data, setData] = useState<LiveOps | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [board, setBoard] = useState<'arrivals' | 'departures' | 'ground'>('arrivals')
  const [clock, setClock] = useState<number | null>(null)

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true)
    try {
      const qs = country && country !== 'ALL' ? `?country=${country}` : ''
      const res = await fetch(`/api/dashboard/live-ops${qs}`)
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || `Live ops ${res.status}`)
      setData(json.data as LiveOps)
      setClock((json.data as LiveOps).nowMinutes)
      setError(null)
    } catch (e) {
      // A failed live panel must never take the rest of the dashboard down with
      // it — it says so in place and the page below carries on.
      setError(e instanceof Error ? e.message : 'Live operations unavailable')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [country])

  useEffect(() => { setLoading(true); load() }, [load])

  useEffect(() => {
    const id = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  // The aircraft on the map move between fetches, not only at them — the clock
  // advances locally off the server's minute so the two never disagree by more
  // than the refresh interval.
  useEffect(() => {
    const id = setInterval(() => setClock(c => (c == null ? c : (c + 1) % 1440)), 60_000)
    return () => clearInterval(id)
  }, [])

  const t = data?.totals
  const flights = useMemo(() => data?.flights ?? [], [data])

  const arrivals = useMemo(
    () => flights.filter(f => f.direction === 'arrival' || f.direction === 'internal'),
    [flights],
  )
  const departures = useMemo(
    () => flights.filter(f => f.direction === 'departure' || f.direction === 'other'),
    [flights],
  )

  const boardRows = board === 'arrivals' ? arrivals : board === 'departures' ? departures : []

  const stamp = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '—'

  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-sky-50/60 to-amber-50/50 text-slate-900 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.35)]">
      {/* ── Backdrop ──
          Morning-light colour fields and a faint dot grid. Pure CSS, no canvas
          and no library: the hero must not cost the dashboard a frame budget. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 via-violet-400 to-amber-400" />
        <div className="absolute -top-32 -left-24 w-[36rem] h-[36rem] rounded-full bg-sky-300/25 blur-[110px] loh-drift" />
        <div className="absolute -bottom-40 right-0 w-[34rem] h-[34rem] rounded-full bg-amber-200/35 blur-[110px] loh-drift loh-drift-2" />
        <div className="absolute top-1/3 left-1/2 w-[26rem] h-[26rem] rounded-full bg-violet-200/30 blur-[110px] loh-drift loh-drift-3" />
        <div className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage: 'radial-gradient(rgba(100,116,139,.22) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(ellipse at 50% 0%, #000 35%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, #000 35%, transparent 78%)',
          }}
        />
      </div>

      <style>{`
        @keyframes lohDrift{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(28px,-22px,0) scale(1.09)}}
        .loh-drift{animation:lohDrift 17s ease-in-out infinite}
        .loh-drift-2{animation-duration:23s;animation-delay:-6s}
        .loh-drift-3{animation-duration:29s;animation-delay:-12s}
        @keyframes lohPing{0%{transform:scale(.7);opacity:.9}75%,100%{transform:scale(2.4);opacity:0}}
        .loh-ping{animation:lohPing 2s cubic-bezier(0,0,.2,1) infinite}
        @media (prefers-reduced-motion: reduce){
          .loh-drift,.loh-ping{animation:none}
        }
      `}</style>

      <div className="relative p-5 sm:p-7 space-y-6">
        {/* ── Title bar ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="relative flex w-2.5 h-2.5">
                <span className="loh-ping absolute inline-flex w-full h-full rounded-full bg-emerald-400" />
                <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">Live Operations</span>
              <span className="text-[10px] text-slate-500 font-semibold inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/80 border border-slate-200">
                <Clock className="w-3 h-3" /> {stamp}
              </span>
            </div>

            <h2 className="mt-2 text-2xl sm:text-4xl font-black tracking-tight leading-tight">
              <span className="bg-gradient-to-r from-slate-900 via-sky-700 to-violet-600 bg-clip-text text-transparent">
                {t ? `${t.paxOnGround.toLocaleString()} guests on the ground` : 'Reading the ground…'}
              </span>
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {userName ? `${userName}, ` : ''}
              {t
                ? <>
                    {t.bookingsOnGround} live file{t.bookingsOnGround === 1 ? '' : 's'} ·{' '}
                    {t.vehiclesOnGround} vehicle{t.vehiclesOnGround === 1 ? '' : 's'} on the road ·{' '}
                    {t.flightsToday} sector{t.flightsToday === 1 ? '' : 's'} today
                  </>
                : 'pulling today’s movement chart, flights and fleet'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Country scope. A locked user sees their own country stated, not a
                control they cannot use. */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/80 border border-slate-200 shadow-sm backdrop-blur">
              {country && country !== 'ALL'
                ? <><CountryFlag country={country} className="w-5 h-auto" />
                    <span className="text-xs font-bold text-slate-700">{data?.countries[0]?.label ?? country}</span></>
                : <><Globe2 className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-bold text-slate-700">All Countries</span></>}
              {!canFilter && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">locked</span>}
            </div>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="p-2.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200 shadow-sm text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-50"
              title="Refresh live operations"
            >
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* ── Pulse tiles ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <PulseTile
            label="Pax On Ground" value={t?.paxOnGround ?? 0} icon={<Users className="w-4 h-4" />}
            hint={t ? `${t.adultsOnGround} ad · ${t.childrenOnGround} ch` : undefined}
            accent="from-yellow-100 to-white" ring="ring-yellow-300/60" text="text-amber-600 bg-yellow-100"
            loading={loading}
          />
          <PulseTile
            label="Files On Ground" value={t?.bookingsOnGround ?? 0} icon={<Briefcase className="w-4 h-4" />}
            hint={t ? `${t.movementsToday} movements today` : undefined}
            accent="from-sky-100 to-white" ring="ring-sky-300/60" text="text-sky-600 bg-sky-100"
            loading={loading}
          />
          <PulseTile
            label="Vehicles On Road" value={t?.vehiclesOnGround ?? 0} icon={<Car className="w-4 h-4" />}
            hint={t ? `${t.driversOnGround} drivers · ${t.guidesOnGround} guides` : undefined}
            accent="from-emerald-100 to-white" ring="ring-emerald-300/60" text="text-emerald-600 bg-emerald-100"
            loading={loading}
          />
          <PulseTile
            label="Arrivals Today" value={t?.arrivalsToday ?? 0} icon={<PlaneLanding className="w-4 h-4" />}
            accent="from-teal-100 to-white" ring="ring-teal-300/60" text="text-teal-600 bg-teal-100"
            loading={loading}
          />
          <PulseTile
            label="Departures Today" value={t?.departuresToday ?? 0} icon={<PlaneTakeoff className="w-4 h-4" />}
            accent="from-orange-100 to-white" ring="ring-orange-300/60" text="text-orange-600 bg-orange-100"
            loading={loading}
          />
          <PulseTile
            label="Airborne Now" value={t?.airborneNow ?? 0} icon={<Plane className="w-4 h-4" />}
            hint={t ? `of ${t.flightsToday} sectors` : undefined}
            accent="from-violet-100 to-white" ring="ring-violet-300/60" text="text-violet-600 bg-violet-100"
            loading={loading} live={(t?.airborneNow ?? 0) > 0}
          />
        </div>

        {/* Movements still without a driver — the one number on this panel that
            is a task rather than a fact, so it only appears when there is one. */}
        {(t?.unassignedMovements ?? 0) > 0 && (
          <Link
            href="/dashboard/mc-report"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors group"
          >
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800 font-semibold">
              {t!.unassignedMovements} movement{t!.unassignedMovements === 1 ? '' : 's'} today with no driver assigned
            </p>
            <ArrowRight className="w-4 h-4 text-amber-600 ml-auto group-hover:translate-x-0.5 transition-transform" />
          </Link>
        )}

        {/* ── Country strip (all-countries view only) ───────────────────── */}
        {(!country || country === 'ALL') && (data?.countries.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2">
            {data!.countries.map(c => (
              <motion.div
                key={c.country}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -2 }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/80 border border-slate-200 shadow-sm backdrop-blur"
              >
                <span className="w-1.5 h-8 rounded-full" style={{ background: c.hex }} />
                {c.country !== 'UNASSIGNED' && <CountryFlag country={c.country} className="w-5 h-auto" />}
                <div className="leading-tight">
                  <p className="text-xs font-bold text-slate-800">{c.label}</p>
                  <p className="text-[10px] text-slate-500">
                    {c.pax} pax · {c.bookings} file{c.bookings === 1 ? '' : 's'}
                    {c.arrivals > 0 && <span className="text-emerald-600 font-semibold"> · {c.arrivals} in</span>}
                    {c.departures > 0 && <span className="text-amber-600 font-semibold"> · {c.departures} out</span>}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* ── Map + board ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-3">
            <LiveOpsMap
              country={country || 'ALL'}
              onGround={data?.onGround ?? []}
              flights={flights}
              nowMinutes={clock ?? data?.nowMinutes ?? 0}
              loading={loading}
            />
          </div>

          <div className="xl:col-span-2 rounded-2xl bg-white/85 border border-slate-200 shadow-sm backdrop-blur overflow-hidden flex flex-col">
            <div className="flex items-center gap-1 p-1.5 m-1.5 rounded-xl bg-slate-100/80">
              {([
                ['arrivals', 'Arrivals', arrivals.length],
                ['departures', 'Departures', departures.length],
                ['ground', 'On Ground', data?.onGround.length ?? 0],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  onClick={() => setBoard(key)}
                  className={cn(
                    'flex-1 px-2 py-2 rounded-lg text-[11px] font-bold transition-colors',
                    board === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {label} <span className="opacity-60">{count}</span>
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto max-h-[420px] divide-y divide-slate-100">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={board}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.18 }}
                >
                  {board === 'ground'
                    ? <GroundList rows={data?.onGround ?? []} loading={loading} />
                    : <FlightBoard rows={boardRows} nowMinutes={clock ?? data?.nowMinutes ?? 0} loading={loading} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}

// ─── Pulse tile ───────────────────────────────────────────────────────────

function PulseTile({
  label, value, icon, hint, accent, ring, text, loading, live,
}: {
  label: string; value: number; icon: React.ReactNode; hint?: string
  accent: string; ring: string; text: string; loading?: boolean; live?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white bg-gradient-to-br p-3.5 ring-1 ring-inset shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        accent, ring,
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('grid place-items-center w-8 h-8 rounded-xl', text)}>{icon}</span>
        {live && (
          <span className="relative flex w-1.5 h-1.5">
            <span className="loh-ping absolute inline-flex w-full h-full rounded-full bg-violet-500 opacity-70" />
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-violet-500" />
          </span>
        )}
      </div>
      <p className={cn('mt-2 text-3xl font-black tabular-nums leading-none', loading ? 'text-slate-300' : 'text-slate-900')}>
        {loading ? '—' : <Counter value={value} />}
      </p>
      <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{hint}</p>}
    </motion.div>
  )
}

// ─── Flight board ─────────────────────────────────────────────────────────

const PHASE_STYLE: Record<LiveFlight['phase'], { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  airborne:  { label: 'In the air', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  landed:    { label: 'Landed',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  unknown:   { label: '—',          cls: 'bg-slate-50 text-slate-400 border-slate-200' },
}

function FlightBoard({ rows, nowMinutes, loading }: { rows: LiveFlight[]; nowMinutes: number; loading?: boolean }) {
  if (loading) {
    return <div className="p-6 space-y-3">
      {[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}
    </div>
  }
  if (rows.length === 0) {
    return <p className="p-8 text-center text-xs text-slate-400">No sectors on this side today</p>
  }

  return (
    <ul>
      {rows.map((f, i) => {
        const phase = PHASE_STYLE[f.phase]
        const progress =
          f.phase === 'landed' ? 1
          : f.phase === 'airborne' && f.depMin != null && f.arrMin != null && f.arrMin > f.depMin
            ? Math.max(0, Math.min(1, (nowMinutes - f.depMin) / (f.arrMin - f.depMin)))
            : 0

        const row = (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.4) }}
            className={cn('px-3.5 py-3 hover:bg-sky-50/60 transition-colors', f.cancelled && 'opacity-45')}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-900 tracking-tight">{f.flightNo}</span>
              {f.airline && <span className="text-[10px] text-slate-400 truncate max-w-[7rem]">{f.airline}</span>}
              <span className={cn('ml-auto px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wide', phase.cls)}>
                {phase.label}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-2 text-[11px] font-bold text-slate-700">
              <span className="tabular-nums text-slate-400">{f.depTime ?? '--:--'}</span>
              <span>{f.from.iata}</span>

              {/* The sector as a rail the aircraft actually sits on. */}
              <span className="relative flex-1 h-[3px] rounded-full bg-slate-200 overflow-visible">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-[width] duration-1000"
                  style={{ width: `${progress * 100}%` }}
                />
                <Plane
                  className={cn(
                    'absolute -top-[7px] w-3.5 h-3.5 rotate-90 transition-[left] duration-1000',
                    f.phase === 'airborne' ? 'text-emerald-500' : 'text-slate-400',
                  )}
                  style={{ left: `calc(${progress * 100}% - 7px)` }}
                />
              </span>

              <span>{f.to.iata}</span>
              <span className="tabular-nums text-slate-400">{f.arrTime ?? '--:--'}</span>
            </div>

            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
              <Users className="w-3 h-3" /> {f.pax} pax
              {f.from.city && f.to.city && <span className="truncate">· {f.from.city} → {f.to.city}</span>}
              {f.bookingRef && <span className="ml-auto font-bold text-sky-600">{f.bookingRef}</span>}
            </div>
          </motion.div>
        )

        return (
          <li key={f.id}>
            {f.bookingRef
              ? <Link href={`/dashboard/bookings/${f.bookingRef}`}>{row}</Link>
              : row}
          </li>
        )
      })}
    </ul>
  )
}

// ─── On-ground list ───────────────────────────────────────────────────────

function GroundList({ rows, loading }: { rows: LiveOnGround[]; loading?: boolean }) {
  if (loading) {
    return <div className="p-6 space-y-3">
      {[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}
    </div>
  }
  if (rows.length === 0) {
    return <p className="p-8 text-center text-xs text-slate-400">Nobody on the ground right now</p>
  }

  return (
    <ul>
      {rows.map((g, i) => (
        <li key={g.bookingRef}>
          <Link href={`/dashboard/bookings/${g.bookingRef}`}>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4) }}
              className="px-3.5 py-3 hover:bg-sky-50/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-900">{g.bookingRef}</span>
                <span className="text-[10px] text-slate-400 truncate">{g.lead ?? g.countryLabel ?? ''}</span>
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                  Day {g.dayNo}/{g.totalDays}
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                <MapPin className="w-3 h-3 text-sky-500 flex-shrink-0" />
                <span className="truncate">
                  {g.leg ? `${g.leg.from.name} → ${g.leg.to.name}` : g.pin?.name ?? g.movement?.to ?? 'No movement charted today'}
                </span>
                <span className="ml-auto flex items-center gap-1 text-slate-700 font-bold flex-shrink-0">
                  <Users className="w-3 h-3" />{g.pax}
                </span>
              </div>

              <div className="mt-1 flex items-center gap-2 text-[10px]">
                {g.arrivingToday && <Badge tone="emerald"><PlaneLanding className="w-2.5 h-2.5" /> Arrives today</Badge>}
                {g.departingToday && <Badge tone="amber"><PlaneTakeoff className="w-2.5 h-2.5" /> Departs today</Badge>}
                {g.movement?.leisure && <Badge tone="slate">Leisure day</Badge>}
                {g.movement?.driver
                  ? <Badge tone="sky"><UserCheck className="w-2.5 h-2.5" /> {g.movement.driver}</Badge>
                  : g.movement?.needsDriver
                    ? <Badge tone="red"><AlertTriangle className="w-2.5 h-2.5" /> No driver</Badge>
                    : null}
                {g.movement?.vehicleType && (
                  <span className="text-slate-400 truncate">{g.movement.vehicleType}</span>
                )}
              </div>
            </motion.div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const BADGE_TONE = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  sky:     'bg-sky-50 text-sky-700 border-sky-200',
  red:     'bg-red-50 text-red-700 border-red-200',
  slate:   'bg-slate-100 text-slate-600 border-slate-200',
}

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONE; children: React.ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold',
      BADGE_TONE[tone],
    )}>
      {children}
    </span>
  )
}
