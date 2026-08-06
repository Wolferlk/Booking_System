'use client'

/**
 * Operational pulse cards for the All Bookings page.
 *
 * Seven live buckets — who is on the ground right now, who lands today or
 * tomorrow, who flies out, what wrapped up yesterday. Clicking a card filters
 * the list below to exactly the rows the count represents; clicking it again
 * clears the filter. Counts come from `/api/bookings/quick-stats`, which uses
 * the same `where` fragments as the list query, so the two can never disagree.
 */

import { useEffect, useRef, useState } from 'react'
import {
  MapPin, PlaneLanding, PlaneTakeoff, Sunrise,
  CalendarRange, CalendarClock, CheckCircle2, Users, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { QUICK_FILTERS, type QuickFilter } from '@/lib/booking-quick-filters'

export interface QuickBucket { count: number; pax: number }
export type QuickStats = Record<QuickFilter, QuickBucket>

interface Tone {
  /** Accent strip + icon tile gradient */
  strip: string
  tile: string
  /** Ring + wash when the card is the active filter */
  activeRing: string
  activeWash: string
  hoverBorder: string
  count: string
  watermark: string
}

const TONES: Record<QuickFilter, Tone> = {
  on_ground: {
    strip: 'from-emerald-400 to-teal-500',
    tile: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100',
    activeRing: 'ring-emerald-400/70 border-emerald-300',
    activeWash: 'bg-gradient-to-br from-emerald-50 to-white',
    hoverBorder: 'hover:border-emerald-200',
    count: 'text-emerald-600',
    watermark: 'text-emerald-500/[0.07]',
  },
  arrivals_today: {
    strip: 'from-sky-400 to-blue-500',
    tile: 'bg-sky-50 text-sky-600 group-hover:bg-sky-100',
    activeRing: 'ring-sky-400/70 border-sky-300',
    activeWash: 'bg-gradient-to-br from-sky-50 to-white',
    hoverBorder: 'hover:border-sky-200',
    count: 'text-sky-600',
    watermark: 'text-sky-500/[0.07]',
  },
  arrivals_tomorrow: {
    strip: 'from-indigo-400 to-violet-500',
    tile: 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100',
    activeRing: 'ring-indigo-400/70 border-indigo-300',
    activeWash: 'bg-gradient-to-br from-indigo-50 to-white',
    hoverBorder: 'hover:border-indigo-200',
    count: 'text-indigo-600',
    watermark: 'text-indigo-500/[0.07]',
  },
  arrivals_upcoming: {
    strip: 'from-violet-400 to-fuchsia-500',
    tile: 'bg-violet-50 text-violet-600 group-hover:bg-violet-100',
    activeRing: 'ring-violet-400/70 border-violet-300',
    activeWash: 'bg-gradient-to-br from-violet-50 to-white',
    hoverBorder: 'hover:border-violet-200',
    count: 'text-violet-600',
    watermark: 'text-violet-500/[0.07]',
  },
  departures_today: {
    strip: 'from-amber-400 to-orange-500',
    tile: 'bg-amber-50 text-amber-600 group-hover:bg-amber-100',
    activeRing: 'ring-amber-400/70 border-amber-300',
    activeWash: 'bg-gradient-to-br from-amber-50 to-white',
    hoverBorder: 'hover:border-amber-200',
    count: 'text-amber-600',
    watermark: 'text-amber-500/[0.07]',
  },
  departures_upcoming: {
    strip: 'from-orange-400 to-rose-500',
    tile: 'bg-orange-50 text-orange-600 group-hover:bg-orange-100',
    activeRing: 'ring-orange-400/70 border-orange-300',
    activeWash: 'bg-gradient-to-br from-orange-50 to-white',
    hoverBorder: 'hover:border-orange-200',
    count: 'text-orange-600',
    watermark: 'text-orange-500/[0.07]',
  },
  completed_yesterday: {
    strip: 'from-slate-400 to-slate-500',
    tile: 'bg-slate-100 text-slate-600 group-hover:bg-slate-200',
    activeRing: 'ring-slate-400/70 border-slate-300',
    activeWash: 'bg-gradient-to-br from-slate-50 to-white',
    hoverBorder: 'hover:border-slate-300',
    count: 'text-slate-700',
    watermark: 'text-slate-500/[0.07]',
  },
}

interface CardMeta { title: string; hint: string; icon: LucideIcon; live?: boolean }

const META: Record<QuickFilter, CardMeta> = {
  on_ground:           { title: 'On Ground',    hint: 'In country now',     icon: MapPin,        live: true },
  arrivals_today:      { title: 'Arrivals',     hint: 'Landing today',      icon: PlaneLanding },
  arrivals_tomorrow:   { title: 'Tomorrow',     hint: 'Arriving tomorrow',  icon: Sunrise },
  arrivals_upcoming:   { title: 'Upcoming',     hint: 'Arrivals in 7 days', icon: CalendarRange },
  departures_today:    { title: 'Departures',   hint: 'Flying out today',   icon: PlaneTakeoff },
  departures_upcoming: { title: 'Departing',    hint: 'Next 7 days out',    icon: CalendarClock },
  completed_yesterday: { title: 'Completed',    hint: 'Ended yesterday',    icon: CheckCircle2 },
}

/** Counts tick up to their value so a refreshed number is impossible to miss. */
function useCountUp(target: number, enabled: boolean) {
  const [value, setValue] = useState(target)
  const frame = useRef<number | null>(null)
  const from  = useRef(target)

  useEffect(() => {
    if (!enabled) { setValue(target); return }
    const start = performance.now()
    const begin = from.current
    const delta = target - begin
    if (delta === 0) { setValue(target); return }

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 550)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(begin + delta * eased))
      if (t < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => { if (frame.current) cancelAnimationFrame(frame.current) }
  }, [target, enabled])

  useEffect(() => { from.current = value }, [value])
  return value
}

function QuickCard({
  filter, bucket, active, dimmed, loading, onSelect,
}: {
  filter: QuickFilter
  bucket: QuickBucket
  active: boolean
  dimmed: boolean
  loading: boolean
  onSelect: (f: QuickFilter) => void
}) {
  const tone = TONES[filter]
  const meta = META[filter]
  const Icon = meta.icon
  const shown = useCountUp(bucket.count, !loading)
  const empty = !loading && bucket.count === 0

  return (
    <button
      type="button"
      onClick={() => onSelect(filter)}
      aria-pressed={active}
      title={active ? `Showing ${meta.title.toLowerCase()} — click to clear` : `Filter to ${meta.hint.toLowerCase()}`}
      className={[
        'group relative overflow-hidden rounded-2xl border text-left w-full',
        'px-3.5 pt-3.5 pb-3 transition-all duration-200 outline-none',
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-400',
        active
          ? `ring-2 ${tone.activeRing} ${tone.activeWash} shadow-card-hover -translate-y-0.5`
          : `bg-white border-slate-200 ${tone.hoverBorder} hover:shadow-card-hover hover:-translate-y-0.5`,
        dimmed ? 'opacity-55 hover:opacity-100' : '',
        empty && !active ? 'opacity-70 hover:opacity-100' : '',
      ].join(' ')}
    >
      {/* Accent strip — full width only when the card is driving the list */}
      <span
        className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${tone.strip} transition-transform duration-300 origin-left ${
          active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
        }`}
      />

      {/* Oversized watermark glyph */}
      <Icon className={`absolute -right-3 -bottom-3 w-20 h-20 ${tone.watermark} pointer-events-none`} strokeWidth={1.25} />

      <div className="relative flex items-start justify-between gap-2">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${tone.tile}`}>
          <Icon className="w-4 h-4" />
        </span>

        {meta.live && !loading && bucket.count > 0 && (
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-600">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        )}

        {active && (
          <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-slate-600">
            Clear <X className="w-2.5 h-2.5" />
          </span>
        )}
      </div>

      <div className="relative mt-2.5">
        {loading ? (
          <div className="h-8 w-12 rounded-lg bg-slate-100 animate-pulse" />
        ) : (
          <p className={`text-[28px] leading-none font-bold tabular-nums ${empty ? 'text-slate-300' : tone.count}`}>
            {shown}
          </p>
        )}
        <p className="text-[13px] font-semibold text-slate-700 mt-1.5 truncate">{meta.title}</p>
        <p className="text-[10.5px] text-slate-400 truncate">{meta.hint}</p>
      </div>

      {/* Pax footer — the number ops actually plans vehicles and rooms around */}
      <div className="relative mt-2 pt-2 border-t border-slate-100 flex items-center gap-1 text-[10px] text-slate-400">
        <Users className="w-3 h-3 shrink-0" />
        {loading
          ? <span className="h-2.5 w-10 rounded bg-slate-100 animate-pulse inline-block" />
          : <span className="font-medium tabular-nums">{bucket.pax} pax</span>}
      </div>
    </button>
  )
}

export default function QuickStatCards({
  stats, loading, active, onSelect,
}: {
  stats: QuickStats | null
  loading: boolean
  active: QuickFilter | null
  onSelect: (f: QuickFilter | null) => void
}) {
  const EMPTY: QuickBucket = { count: 0, pax: 0 }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
      {QUICK_FILTERS.map(f => (
        <QuickCard
          key={f}
          filter={f}
          bucket={stats?.[f] ?? EMPTY}
          active={active === f}
          dimmed={active !== null && active !== f}
          loading={loading}
          onSelect={next => onSelect(active === next ? null : next)}
        />
      ))}
    </div>
  )
}
