'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PlaneLanding, PlaneTakeoff, Plane, Route, Layers, SlidersHorizontal, ChevronDown,
  Clock, UserCheck, CalendarRange, Flag, Ban, Search, Check, X, Link2, Zap,
  Sunrise, Sun, Sunset, Moon, CircleDashed,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  EMPTY_FILTERS, FLOW_OPTIONS, TIME_BUCKETS, DRIVER_STATES, TRIP_STAGES, FLAGS, QUICK_VIEWS,
  activeFilterCount, airportName, matchingQuickView, quickViewFilters,
  type AdvancedFilters, type FacetCounts, type FlowFilter, type TimeBucket, type CancelMode,
} from '@/lib/mc-report-filters'

const FLOW_ICON: Record<FlowFilter, typeof Plane> = {
  all: Layers, arrivals: PlaneLanding, departures: PlaneTakeoff, airport: Plane, touring: Route,
}

/** The active tone per flow — arrivals green, departures blue, like the flight chips on the chart. */
const FLOW_TONE: Record<FlowFilter, string> = {
  all:        'bg-slate-900 text-white ring-slate-900',
  arrivals:   'bg-emerald-600 text-white ring-emerald-600 shadow-emerald-600/30',
  departures: 'bg-sky-600 text-white ring-sky-600 shadow-sky-600/30',
  airport:    'bg-indigo-600 text-white ring-indigo-600 shadow-indigo-600/30',
  touring:    'bg-amber-500 text-white ring-amber-500 shadow-amber-500/30',
}

const TIME_ICON: Record<TimeBucket, typeof Sun> = {
  early: Moon, morning: Sunrise, afternoon: Sun, night: Sunset, none: CircleDashed,
}

const OPEN_KEY = 'mc-report.more-filters-open'

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v]
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function Chip({
  active, count, onClick, children, title, tone = 'brand',
}: {
  active: boolean
  count?: number
  onClick: () => void
  children: React.ReactNode
  title?: string
  tone?: 'brand' | 'rose' | 'emerald' | 'sky'
}) {
  const on = {
    brand:   'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500/30',
    rose:    'border-rose-400 bg-rose-50 text-rose-800 ring-1 ring-rose-400/30',
    emerald: 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500/30',
    sky:     'border-sky-500 bg-sky-50 text-sky-800 ring-1 ring-sky-500/30',
  }[tone]
  const dead = !active && count === 0
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all',
        active ? on : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
        dead && 'opacity-45',
      )}
    >
      {active && <Check className="h-3 w-3" />}
      {children}
      {count != null && (
        <span className={cn(
          'rounded-full px-1.5 text-[10px] tabular-nums',
          active ? 'bg-white/80' : 'bg-slate-100 text-slate-500',
        )}>{count}</span>
      )}
    </button>
  )
}

function Group({ icon: Icon, label, children, onClear, active }: {
  icon: typeof Clock
  label: string
  children: React.ReactNode
  onClear?: () => void
  active?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <Icon className="h-3 w-3 text-slate-400" /> {label}
        </span>
        {active && onClear && (
          <button type="button" onClick={onClear} className="text-[10px] font-semibold text-slate-400 hover:text-slate-700">
            reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/**
 * A searchable multi-select with live counts — for the long lists (agents,
 * cities, drivers) that would be a wall of chips. Options with nothing behind
 * them under the other filters drop to the bottom instead of disappearing, so
 * a selected value never vanishes from the list it was picked in.
 */
function FacetMulti({ label, icon: Icon, options, selected, onChange, emptyLabel, format }: {
  label: string
  icon: typeof Clock
  options: [string, number][]
  selected: string[]
  onChange: (next: string[]) => void
  emptyLabel: string
  format?: (v: string) => string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const all = useMemo(() => {
    const m = new Map(options)
    for (const s of selected) if (!m.has(s)) m.set(s, 0)
    return Array.from(m.entries())
  }, [options, selected])
  const shown = all.filter(([v]) => (format ? format(v) : v).toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
          selected.length ? 'border-brand-400 bg-brand-50/60 text-brand-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
        )}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        <span className="flex-1 truncate">
          {selected.length === 0 ? <span className="text-slate-400">{label}: any</span>
            : selected.length === 1 ? <><span className="text-slate-500">{label}:</span> <strong>{format ? format(selected[0]) : selected[0]}</strong></>
            : <><span className="text-slate-500">{label}:</span> <strong>{selected.length} selected</strong></>}
        </span>
        {selected.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); onChange([]) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onChange([]) } }}
            className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
            aria-label={`Clear ${label}`}
          >
            <X className="h-3 w-3" />
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 min-w-[240px] rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={`Find ${label.toLowerCase()}…`}
              className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-xs focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 && <p className="px-3 py-3 text-center text-[11px] text-slate-400">{emptyLabel}</p>}
            {shown.map(([v, n]) => {
              const on = selected.includes(v)
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange(toggle(selected, v))}
                  className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50', n === 0 && !on && 'opacity-50')}
                >
                  <span className={cn(
                    'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                    on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300',
                  )}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="flex-1 truncate text-slate-700">{format ? format(v) : v}</span>
                  <span className="text-[10px] tabular-nums text-slate-400">{n}</span>
                </button>
              )
            })}
          </div>
          {selected.length > 0 && (
            <div className="flex justify-between border-t border-slate-100 px-3 py-1.5">
              <span className="text-[10px] text-slate-400">{selected.length} selected</span>
              <button type="button" onClick={() => onChange([])} className="text-[10px] font-semibold text-slate-500 hover:text-slate-800">
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function AdvancedFilterPanel({ filters, onChange, counts, shown, total }: {
  filters: AdvancedFilters
  onChange: (next: AdvancedFilters) => void
  counts: FacetCounts
  /** Rows on screen after every filter. */
  shown: number
  /** Rows loaded for the date range. */
  total: number
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    try { setMoreOpen(localStorage.getItem(OPEN_KEY) === '1') } catch { /* blocked storage — start closed */ }
  }, [])
  function toggleMore() {
    setMoreOpen(v => {
      try { localStorage.setItem(OPEN_KEY, v ? '0' : '1') } catch { /* ignore */ }
      return !v
    })
  }

  const set = <K extends keyof AdvancedFilters>(k: K, v: AdvancedFilters[K]) => onChange({ ...filters, [k]: v })
  const activeCount = activeFilterCount(filters)
  const activeView  = matchingQuickView(filters)
  // Count of filters tucked away behind "More filters", so a closed panel
  // still owns up to narrowing the chart.
  const hiddenActive = activeCount - (filters.flow !== 'all' ? 1 : 0)

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => toast.success('Link copied — it opens with these filters'))
      .catch(() => toast.error('Could not copy the link'))
  }

  // ── Active-filter pills ────────────────────────────────────────────────────
  const pills: { key: string; label: string; clear: () => void }[] = []
  if (filters.flow !== 'all') pills.push({ key: 'flow', label: FLOW_OPTIONS.find(o => o.key === filters.flow)!.label, clear: () => set('flow', 'all') })
  for (const t of filters.times)  pills.push({ key: `t-${t}`, label: TIME_BUCKETS.find(b => b.key === t)!.label, clear: () => set('times', filters.times.filter(x => x !== t)) })
  for (const d of filters.driver) pills.push({ key: `d-${d}`, label: DRIVER_STATES.find(b => b.key === d)!.label, clear: () => set('driver', filters.driver.filter(x => x !== d)) })
  for (const s of filters.stages) pills.push({ key: `s-${s}`, label: TRIP_STAGES.find(b => b.key === s)!.label, clear: () => set('stages', filters.stages.filter(x => x !== s)) })
  for (const a of filters.airports) pills.push({ key: `a-${a}`, label: `${a} ${airportName(a)}`, clear: () => set('airports', filters.airports.filter(x => x !== a)) })
  for (const f of filters.flags)  pills.push({ key: `f-${f}`, label: FLAGS.find(b => b.key === f)!.label, clear: () => set('flags', filters.flags.filter(x => x !== f)) })
  for (const a of filters.agents) pills.push({ key: `ag-${a}`, label: `Agent: ${a || '—'}`, clear: () => set('agents', filters.agents.filter(x => x !== a)) })
  for (const l of filters.locations) pills.push({ key: `l-${l}`, label: `City: ${l}`, clear: () => set('locations', filters.locations.filter(x => x !== l)) })
  for (const d of filters.drivers) pills.push({ key: `dr-${d}`, label: `Driver: ${d || '—'}`, clear: () => set('drivers', filters.drivers.filter(x => x !== d)) })
  if (filters.cancelled !== 'show') pills.push({ key: 'c', label: filters.cancelled === 'hide' ? 'Hide cancelled' : 'Cancelled only', clear: () => set('cancelled', 'show') })

  return (
    <div className="space-y-4">
      {/* Quick views */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <Zap className="h-3 w-3 text-amber-500" /> Quick views
        </span>
        {QUICK_VIEWS.map(v => (
          <button
            key={v.key}
            type="button"
            title={v.hint}
            onClick={() => onChange(activeView === v.key ? EMPTY_FILTERS : quickViewFilters(v.key)!)}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-semibold transition-all',
              activeView === v.key
                ? 'border-amber-500 bg-amber-500 text-white shadow-sm shadow-amber-500/30'
                : 'border-amber-200 bg-amber-50/60 text-amber-800 hover:border-amber-400 hover:bg-amber-50',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Movement flow — the headline filter */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {FLOW_OPTIONS.map(o => {
          const Icon = FLOW_ICON[o.key]
          const on = filters.flow === o.key
          const n = counts.flow[o.key]
          const pax = o.key === 'arrivals' ? counts.arrivalPax : o.key === 'departures' ? counts.departurePax : null
          return (
            <button
              key={o.key}
              type="button"
              title={o.hint}
              onClick={() => set('flow', on && o.key !== 'all' ? 'all' : o.key)}
              className={cn(
                'group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left ring-1 transition-all',
                on ? cn(FLOW_TONE[o.key], 'shadow-md') : 'bg-white text-slate-700 ring-slate-200 hover:ring-slate-300 hover:shadow-sm',
                !on && n === 0 && o.key !== 'all' && 'opacity-50',
              )}
            >
              <span className={cn(
                'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
                on ? 'bg-white/20' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200',
              )}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold">{o.label}</span>
                <span className={cn('block truncate text-[10px]', on ? 'text-white/80' : 'text-slate-400')}>
                  {n} movement{n === 1 ? '' : 's'}{pax != null ? ` · ${pax} pax` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Bar: active pills + more toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggleMore}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors',
            moreOpen ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {moreOpen ? 'Hide filters' : 'More filters'}
          {hiddenActive > 0 && (
            <span className={cn('rounded-full px-1.5 text-[10px]', moreOpen ? 'bg-white/20' : 'bg-brand-500 text-white')}>
              {hiddenActive}
            </span>
          )}
          <ChevronDown className={cn('h-3 w-3 transition-transform', moreOpen && 'rotate-180')} />
        </button>

        {pills.map(p => (
          <span key={p.key} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-brand-800">
            {p.label}
            <button type="button" onClick={p.clear} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`Remove ${p.label}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {activeCount > 0 && (
          <>
            <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
              Reset all
            </button>
            <button type="button" onClick={copyLink} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800" title="Copy a link to this exact view">
              <Link2 className="h-3 w-3" /> Copy link
            </button>
            <span className="ml-auto text-[11px] text-slate-500">
              <strong className="text-slate-800">{shown}</strong> of {total} movements
            </span>
          </>
        )}
      </div>

      {moreOpen && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Group icon={Clock} label="Time of day (flight time, else meeting time)" active={filters.times.length > 0} onClear={() => set('times', [])}>
              {TIME_BUCKETS.map(b => {
                const Icon = TIME_ICON[b.key]
                return (
                  <Chip key={b.key} active={filters.times.includes(b.key)} count={counts.times[b.key]}
                    title={b.range} onClick={() => set('times', toggle(filters.times, b.key))}>
                    <Icon className="h-3 w-3" /> {b.label}
                  </Chip>
                )
              })}
            </Group>

            <Group icon={UserCheck} label="Driver / vendor" active={filters.driver.length > 0} onClear={() => set('driver', [])}>
              {DRIVER_STATES.map(d => (
                <Chip key={d.key} active={filters.driver.includes(d.key)} count={counts.driver[d.key]}
                  tone={d.key === 'needs' ? 'rose' : d.key === 'assigned' ? 'emerald' : 'brand'}
                  onClick={() => set('driver', toggle(filters.driver, d.key))}>
                  {d.label}
                </Chip>
              ))}
            </Group>

            <Group icon={CalendarRange} label="Day of the trip" active={filters.stages.length > 0} onClear={() => set('stages', [])}>
              {TRIP_STAGES.map(s => (
                <Chip key={s.key} active={filters.stages.includes(s.key)} count={counts.stages[s.key]}
                  onClick={() => set('stages', toggle(filters.stages, s.key))}>
                  {s.label}
                </Chip>
              ))}
            </Group>

            <Group icon={Plane} label="Airport" active={filters.airports.length > 0} onClear={() => set('airports', [])}>
              {counts.airports.length === 0 && filters.airports.length === 0 && (
                <span className="text-[11px] italic text-slate-400">No named airport on these movements</span>
              )}
              {[...counts.airports, ...filters.airports.filter(a => !counts.airports.some(([c]) => c === a)).map(a => [a, 0] as [string, number])]
                .map(([code, n]) => (
                  <Chip key={code} active={filters.airports.includes(code)} count={n} tone="sky"
                    title={airportName(code)} onClick={() => set('airports', toggle(filters.airports, code))}>
                    <span className="font-mono">{code}</span>
                    <span className="font-normal text-slate-500">{airportName(code) !== code ? airportName(code) : ''}</span>
                  </Chip>
                ))}
            </Group>

            <Group icon={Flag} label="Must have (all selected)" active={filters.flags.length > 0} onClear={() => set('flags', [])}>
              {FLAGS.map(f => (
                <Chip key={f.key} active={filters.flags.includes(f.key)} count={counts.flags[f.key]}
                  onClick={() => set('flags', toggle(filters.flags, f.key))}>
                  {f.label}
                </Chip>
              ))}
            </Group>

            <Group icon={Ban} label="Cancelled files">
              <div className="inline-flex rounded-lg bg-white p-0.5 text-[11px] font-semibold ring-1 ring-slate-200">
                {([['show', 'Show'], ['hide', 'Hide'], ['only', `Only (${counts.cancelled})`]] as [CancelMode, string][]).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => set('cancelled', k)}
                    className={cn(
                      'rounded-md px-3 py-1 transition-colors',
                      filters.cancelled === k
                        ? k === 'only' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:text-slate-800',
                    )}>
                    {l}
                  </button>
                ))}
              </div>
            </Group>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <FacetMulti label="Agent" icon={Search} options={counts.agents} selected={filters.agents}
              onChange={v => set('agents', v)} emptyLabel="No agents match" />
            <FacetMulti label="City" icon={Search} options={counts.locations} selected={filters.locations}
              onChange={v => set('locations', v)} emptyLabel="No cities match" />
            <FacetMulti label="Driver / Vendor" icon={Search} options={counts.drivers} selected={filters.drivers}
              onChange={v => set('drivers', v)} emptyLabel="Nobody allocated in this range" />
          </div>
        </div>
      )}
    </div>
  )
}

/** A small pill on a chart row saying it is an airport run, and how we know. */
export function FlowBadge({ arrival, departure, source, time, airport }: {
  arrival: boolean
  departure: boolean
  source: 'flight' | 'route' | 'day' | null
  time: string | null
  airport: string | null
}) {
  if (!arrival && !departure) return null
  const both = arrival && departure
  const Icon = both ? Plane : arrival ? PlaneLanding : PlaneTakeoff
  const how = source === 'flight' ? 'from the flight on this date'
    : source === 'route' ? 'from the airport in the route'
    : 'from the details on the arrival / departure day'
  return (
    <span
      title={`${both ? 'Arrival & departure' : arrival ? 'Arrival' : 'Departure'} — detected ${how}${airport ? ` · ${airport}` : ''}`}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 whitespace-nowrap',
        both ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
          : arrival ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          : 'bg-sky-50 text-sky-700 ring-sky-200',
      )}
    >
      <Icon className="h-3 w-3" />
      {both ? 'Arr + Dep' : arrival ? 'Arrival' : 'Departure'}
      {airport && <span className="font-mono opacity-70">{airport}</span>}
      {time && source === 'flight' && <span className="opacity-70">{time}</span>}
    </span>
  )
}
