'use client'

/**
 * Drill-down for one card on the operations board.
 *
 * Clicking a gauge (Reconfirmation / Drivers / Tickets / QC) or a movement tile
 * (On Ground / Arrivals / Departures) opens this over the board with the same
 * question asked at greater depth: **which tours, over what stretch of dates, in
 * which countries, and what exactly is missing on each.**
 *
 * Three things it adds over the board underneath:
 *   • a **date range** rather than a single day, with presets, so "everything
 *     unallocated this month" is one click;
 *   • a **country** breakdown that doubles as a filter — the chips and the
 *     bars are the same control;
 *   • a **per-day timeline** of the focused check across the range, which is
 *     where a bad week shows itself as a block of red rather than as a number.
 *
 * Range changes refetch; country, state and search filter the loaded rows in
 * the browser, so those are instant and cannot widen the user's country scope
 * beyond what the API already granted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  X, Loader2, Download, Search, CalendarRange, Globe2, ArrowUpDown,
  PlaneLanding, PlaneTakeoff, ExternalLink, CircleAlert, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import type { OpsDayBoard, OpsDayRow } from '@/lib/reports/ops-day-data'
import type { ReadinessState } from '@/lib/booking-readiness'
import {
  CountUp, ProgressRing, SegmentBar, StatePill, STATE_STYLE, FOCUS_META,
  ReconfirmFacetBar, stateForFocus, textForFocus, detailForFocus, inFocus,
  callDetail, qcTick,
  type FocusKey,
} from './ops-board-parts'
import {
  APPROVAL_LABEL, countFacets, matchesFacets, type ReconfirmFacet,
} from '@/lib/reports/reconfirm-filters'

// ─── Range presets ────────────────────────────────────────────────────────────

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/** Monday-first week containing `date`. */
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return shift(date, dow === 0 ? -6 : 1 - dow)
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const PRESETS: { key: string; label: string; of: (anchor: string) => [string, string] }[] = [
  { key: 'day',    label: 'That day',   of: a => [a, a] },
  { key: 'w3',     label: '±3 days',    of: a => [shift(a, -3), shift(a, 3)] },
  { key: 'week',   label: 'This week',  of: a => [weekStart(a), shift(weekStart(a), 6)] },
  { key: 'next7',  label: 'Next 7',     of: a => [a, shift(a, 6)] },
  { key: 'next30', label: 'Next 30',    of: a => [a, shift(a, 29)] },
  { key: 'month',  label: 'This month', of: a => [monthStart(a), monthEnd(a)] },
]

type SortKey = 'date' | 'state' | 'ref' | 'pax'

/** Pending first — the drill-down exists to surface what is wrong. */
const STATE_RANK: Record<ReadinessState, number> = { PENDING: 0, PARTIAL: 1, NA: 2, DONE: 3 }

// ─── Component ────────────────────────────────────────────────────────────────

export default function OpsDrilldown({
  focus,
  anchorDate,
  anchorEnd,
  countryFilter,
  initialBoard,
  onClose,
}: {
  focus: FocusKey
  /** The board's window start — the range opens on this day. */
  anchorDate: string
  /** The board's window end. Omitted (or equal) when the board shows one day. */
  anchorEnd?: string
  /** Global country scope, passed straight through to the API. */
  countryFilter: string
  /** The board's already-loaded single-day data, shown until a range is chosen. */
  initialBoard: OpsDayBoard | null
  onClose: () => void
}) {
  const reduce = useReducedMotion()
  const meta = FOCUS_META[focus]

  const [from, setFrom] = useState(anchorDate)
  const [to, setTo] = useState(anchorEnd ?? anchorDate)
  const [board, setBoard] = useState<OpsDayBoard | null>(initialBoard)
  const [loading, setLoading] = useState(false)
  const [countries, setCountries] = useState<Set<string>>(new Set())
  const [states, setStates] = useState<Set<ReadinessState>>(new Set())
  const [facets, setFacets] = useState<Set<ReconfirmFacet>>(new Set())
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('state')
  const [mounted, setMounted] = useState(false)

  // The first render reuses the board's data, so skip the initial fetch and only
  // go to the server once the range actually moves off the anchor day.
  const skipFirst = useRef(initialBoard !== null)

  useEffect(() => { setMounted(true) }, [])

  // Escape closes; the page behind must not scroll while this is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res = await fetch(`/api/accounts/report/ops?${params}`)
      const json = await res.json()
      if (json.success) setBoard(json.data as OpsDayBoard)
      else toast.error(json.error ?? 'Failed to load the range')
    } catch {
      toast.error('Failed to load the range')
    } finally {
      setLoading(false)
    }
  }, [from, to, countryFilter])

  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return }
    load()
  }, [load])

  // ── Filtering ──────────────────────────────────────────────────────────────

  /** Every row this focus is about, before the in-browser filters. */
  const scoped = useMemo(
    () => (board?.rows ?? []).filter(r => inFocus(focus, r)),
    [board, focus],
  )

  const countryOptions = useMemo(() => {
    const map = new Map<string, { country: string; label: string; total: number; done: number; partial: number; pending: number; na: number }>()
    for (const r of scoped) {
      const e = map.get(r.country)
        ?? { country: r.country, label: r.countryLabel, total: 0, done: 0, partial: 0, pending: 0, na: 0 }
      e.total += 1
      const s = stateForFocus(focus, r)
      if (s === 'DONE') e.done += 1
      else if (s === 'PARTIAL') e.partial += 1
      else if (s === 'PENDING') e.pending += 1
      else e.na += 1
      map.set(r.country, e)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  }, [scoped, focus])

  /**
   * Everything the range, country and search allow — but *before* the state
   * chips are applied. The headline ring, the chip counts and the timeline all
   * read from here, so filtering down to "pending" narrows the list without
   * collapsing the numbers that describe it.
   */
  const preState = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(r => {
      if (countries.size && !countries.has(r.country)) return false
      if (!q) return true
      return [r.bookingRef, r.leadPassenger, r.agent, r.fileHandler, r.destination]
        .some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [scoped, countries, search])

  const facetCounts = useMemo(() => countFacets(preState), [preState])

  const rows = useMemo(() => {
    let out = states.size
      ? preState.filter(r => states.has(stateForFocus(focus, r)))
      : preState.slice()
    if (facets.size) out = out.filter(r => matchesFacets(facets, r))

    return out.sort((a, b) => {
      if (sort === 'state') {
        return STATE_RANK[stateForFocus(focus, a)] - STATE_RANK[stateForFocus(focus, b)]
          || a.arrivalDate.localeCompare(b.arrivalDate)
      }
      if (sort === 'ref') return a.bookingRef.localeCompare(b.bookingRef)
      if (sort === 'pax') return b.pax - a.pax
      return a.arrivalDate.localeCompare(b.arrivalDate) || a.bookingRef.localeCompare(b.bookingRef)
    })
  }, [preState, states, facets, sort, focus])

  // ── Headline numbers ───────────────────────────────────────────────────────

  const counts = useMemo(() => {
    const c: Record<ReadinessState, number> = { DONE: 0, PARTIAL: 0, PENDING: 0, NA: 0 }
    for (const r of preState) c[stateForFocus(focus, r)] += 1
    // N/A never counts against a check — a tour with no tickets to buy should
    // not drag the gauge down.
    const scope = c.DONE + c.PARTIAL + c.PENDING
    const pct = scope > 0 ? ((c.DONE + c.PARTIAL * 0.5) / scope) * 100 : 0
    const state: ReadinessState = scope === 0 ? 'NA'
      : c.DONE === scope ? 'DONE'
        : c.DONE + c.PARTIAL > 0 ? 'PARTIAL' : 'PENDING'
    return { ...c, scope, pct, state, total: preState.length, pax: preState.reduce((s, r) => s + r.pax, 0) }
  }, [preState, focus])

  /**
   * The focused check, day by day across the range.
   *
   * A tour counts on every day it is on the ground, so a ten-day tour with no
   * driver paints ten days red — which is the point: it is a problem on all of
   * them. Movement focuses count only the day the guest lands or leaves.
   */
  const timeline = useMemo(() => {
    const span = daysBetween(from, to) + 1
    if (span < 2 || span > 92) return []
    return Array.from({ length: span }, (_, i) => {
      const date = shift(from, i)
      const onDay = preState.filter(r =>
        focus === 'arrivals' ? r.arrivalDate === date
          : focus === 'departures' ? r.departureDate === date
            : r.arrivalDate <= date && r.departureDate >= date)
      const c: Record<ReadinessState, number> = { DONE: 0, PARTIAL: 0, PENDING: 0, NA: 0 }
      for (const r of onDay) c[stateForFocus(focus, r)] += 1
      return { date, total: onDay.length, ...c }
    })
  }, [preState, from, to, focus])

  const timelinePeak = Math.max(1, ...timeline.map(d => d.total))

  function applyPreset(p: typeof PRESETS[number]) {
    const [a, b] = p.of(anchorDate)
    setFrom(a)
    setTo(b)
  }

  function toggle<T>(set: Set<T>, value: T, apply: (s: Set<T>) => void) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    apply(next)
  }

  function exportCSV() {
    if (!rows.length) { toast.error('Nothing to export'); return }
    const headers = [
      'Booking Ref', 'Booking Type', 'Lead Passenger', 'Agent', 'File Handler', 'Country', 'Destination',
      'Status', 'Arrival', 'Departure', 'Days', 'Pax',
      `${meta.label} — State`, `${meta.label} — Detail`,
      'Client Confirmed', 'Pre-Tour Call', 'Call Outcome',
      'WhatsApp Call Request', 'Request Sent', 'Accepted On', 'Call Scheduled', 'Call Schedule Status',
      'Driver Allocation', 'Tickets', 'QC1', 'QC2', 'Outstanding',
    ]
    const lines = rows.map(r => [
      r.bookingRef,
      r.hotelOnly ? 'Hotel Only' : 'Full tour',
      r.leadPassenger ?? '', r.agent ?? '', r.fileHandler ?? '',
      r.countryLabel, r.destination ?? '', r.statusLabel,
      r.arrivalDate, r.departureDate, r.totalDays, r.pax,
      STATE_STYLE[stateForFocus(focus, r)].label, detailForFocus(focus, r),
      r.clientConfirmed ? 'Yes' : 'No',
      r.preTourCall ? `Yes (${r.preTourCall.at})` : 'No',
      r.preTourCall?.outcome ?? '',
      APPROVAL_LABEL[r.call.approval],
      r.call.approvalRequestedAt?.slice(0, 10) ?? '',
      r.call.approvedAt?.slice(0, 10) ?? '',
      r.call.scheduledAt?.slice(0, 10) ?? '',
      r.call.scheduleStatus ?? '',
      r.driver.short, r.tickets.short,
      qcTick(r, 1) === 'DONE' ? 'Pass' : 'Pending',
      qcTick(r, 2) === 'DONE' ? 'Pass' : 'Pending',
      r.outstanding.join('; ') || 'None',
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))

    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ops-${focus}-${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${rows.length} tours`)
  }

  const activePreset = PRESETS.find(p => {
    const [a, b] = p.of(anchorDate)
    return a === from && b === to
  })?.key

  const filtersOn = countries.size > 0 || states.size > 0 || facets.size > 0 || search.trim().length > 0

  function toggleFacet(key: ReconfirmFacet) {
    setFacets(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!mounted) return null

  // The exit animation is driven by the caller's <AnimatePresence>; framer
  // propagates presence through the portal, so this needs no wrapper of its own.
  return createPortal(
    <motion.div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-slate-900/60 backdrop-blur-sm"
        initial={reduce ? undefined : { opacity: 0 }}
        animate={reduce ? undefined : { opacity: 1 }}
        exit={reduce ? undefined : { opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      >
        <motion.div
          className="relative w-full sm:max-w-6xl max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
          initial={reduce ? undefined : { opacity: 0, y: 40, scale: 0.98 }}
          animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`${meta.label} detail`}
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="relative px-5 sm:px-7 pt-6 pb-5 bg-gradient-to-br from-slate-900 via-slate-800 to-navy-900 text-white flex-shrink-0">
            <span className="absolute -right-10 -top-16 w-48 h-48 rounded-full bg-white/5" />
            <span className="absolute right-16 -bottom-20 w-40 h-40 rounded-full bg-white/5" />

            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="relative flex items-center gap-5">
              <ProgressRing pct={counts.pct} color={STATE_STYLE[counts.state].ring} size={84} stroke={8}>
                <span className="text-base font-extrabold leading-none text-white">
                  <CountUp value={counts.DONE} />
                </span>
                <span className="text-[10px] text-white/60 font-semibold">of {counts.scope}</span>
              </ProgressRing>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <meta.icon className="w-4 h-4 text-brand-400" />
                  <h2 className="text-xl font-extrabold tracking-tight">{meta.label}</h2>
                </div>
                <p className="text-xs text-white/60 mt-0.5">{meta.hint}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-xs">
                  <span className="text-white/80">
                    <CountUp value={counts.total} className="font-bold" /> tours
                  </span>
                  <span className="text-white/80">
                    <CountUp value={counts.pax} className="font-bold" /> pax
                  </span>
                  {counts.PARTIAL > 0 && <span className="text-amber-300 font-semibold">{counts.PARTIAL} partial</span>}
                  {counts.PENDING > 0 && <span className="text-rose-300 font-semibold">{counts.PENDING} pending</span>}
                  {counts.NA > 0 && <span className="text-white/40">{counts.NA} n/a</span>}
                  <span className="text-white/40">·</span>
                  <span className="text-white/60">{board?.label ?? ''}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Controls ────────────────────────────────────────────────── */}
          <div className="px-5 sm:px-7 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0 space-y-3">
            {/* Range */}
            <div className="flex flex-wrap items-center gap-2">
              <CalendarRange className="w-4 h-4 text-slate-400 flex-shrink-0" />
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p)}
                  className={cn(
                    'relative px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors',
                    activePreset === p.key ? 'text-white' : 'text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {activePreset === p.key && (
                    <motion.span
                      layoutId="preset-pill"
                      className="absolute inset-0 rounded-lg bg-slate-900"
                      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative">{p.label}</span>
                </button>
              ))}
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  type="date"
                  className="form-input py-1 text-[11px] w-32"
                  value={from}
                  max={to}
                  onChange={e => e.target.value && setFrom(e.target.value)}
                />
                <span className="text-slate-400 text-xs">→</span>
                <input
                  type="date"
                  className="form-input py-1 text-[11px] w-32"
                  value={to}
                  min={from}
                  onChange={e => e.target.value && setTo(e.target.value)}
                />
                <span className="text-[11px] text-slate-400 w-14">
                  {daysBetween(from, to) + 1} day{daysBetween(from, to) === 0 ? '' : 's'}
                </span>
              </div>
            </div>

            {/* Country + state + search */}
            <div className="flex flex-wrap items-center gap-2">
              <Globe2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
              {countryOptions.length === 0 && <span className="text-[11px] text-slate-400">No countries in range</span>}
              {countryOptions.map(c => {
                const on = countries.has(c.country)
                return (
                  <button
                    key={c.country}
                    onClick={() => toggle(countries, c.country, setCountries)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
                      on
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
                    )}
                  >
                    {c.label}
                    <span className={cn('ml-1.5 font-bold', on ? 'text-white/60' : 'text-slate-400')}>{c.total}</span>
                  </button>
                )
              })}

              <span className="w-px h-5 bg-slate-200 mx-1" />

              {(['DONE', 'PARTIAL', 'PENDING', 'NA'] as ReadinessState[]).map(s => {
                const on = states.has(s)
                return (
                  <button
                    key={s}
                    onClick={() => toggle(states, s, setStates)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
                      on ? STATE_STYLE[s].chip : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400',
                    )}
                  >
                    <span className={cn('w-2 h-2 rounded-full', STATE_STYLE[s].dot)} />
                    {STATE_STYLE[s].label}
                    <span className="font-bold opacity-60">{counts[s]}</span>
                  </button>
                )
              })}

              <div className="relative ml-auto">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  className="form-input pl-8 py-1 text-[11px] w-48"
                  placeholder="Ref, passenger, agent…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <button
                onClick={() => setSort(s => s === 'state' ? 'date' : s === 'date' ? 'pax' : s === 'pax' ? 'ref' : 'state')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 hover:border-slate-400 transition-colors"
                title="Change sort order"
              >
                <ArrowUpDown className="w-3 h-3" />
                {sort === 'state' ? 'Worst first' : sort === 'date' ? 'By date' : sort === 'pax' ? 'By pax' : 'By ref'}
              </button>
              {filtersOn && (
                <button
                  onClick={() => { setCountries(new Set()); setStates(new Set()); setFacets(new Set()); setSearch('') }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors"
                >
                  Clear
                </button>
              )}
              <button onClick={exportCSV} className="btn btn-secondary btn-sm py-1 text-[11px]">
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
          </div>

          {/* ── Body ────────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-400">
                <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
                <span className="text-xs">Loading {daysBetween(from, to) + 1} days…</span>
              </div>
            ) : (
              <>
                {board?.truncated && (
                  <div className="flex items-start gap-2 mx-5 sm:mx-7 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>This range hit the row limit — narrow the dates for a complete picture.</span>
                  </div>
                )}

                {/* Reconfirmation chips — the same five questions as the board,
                    asked across the whole range. */}
                <div className="px-5 sm:px-7 pt-5">
                  <ReconfirmFacetBar
                    selected={facets}
                    counts={facetCounts}
                    total={preState.length}
                    onToggle={toggleFacet}
                    onClear={() => setFacets(new Set())}
                    approvalUnavailable={board ? !board.approvalDataAvailable : false}
                  />
                </div>

                {/* Timeline — only earns its space on a multi-day range. */}
                {timeline.length > 1 && (
                  <div className="px-5 sm:px-7 pt-5">
                    <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                      Day by day
                    </h3>
                    <div className="flex items-end gap-[3px] h-24 overflow-x-auto scrollbar-hide pb-1">
                      {timeline.map((d, i) => (
                        <button
                          key={d.date}
                          onClick={() => { setFrom(d.date); setTo(d.date) }}
                          title={`${formatDate(d.date)} — ${d.total} tour(s): ${d.DONE} done, ${d.PARTIAL} partial, ${d.PENDING} pending`}
                          className="group relative flex-1 min-w-[8px] h-full flex flex-col justify-end hover:opacity-80 transition-opacity"
                        >
                          {(['PENDING', 'PARTIAL', 'DONE', 'NA'] as ReadinessState[]).map(s => (
                            <motion.span
                              key={s}
                              className={cn('block w-full first:rounded-t-sm', STATE_STYLE[s].dot)}
                              initial={reduce ? undefined : { height: 0 }}
                              animate={{ height: `${(d[s] / timelinePeak) * 100}%` }}
                              transition={reduce ? { duration: 0 } : { duration: 0.5, delay: Math.min(i, 30) * 0.01, ease: [0.16, 1, 0.3, 1] }}
                            />
                          ))}
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>{formatDate(from)}</span>
                      <span>peak {timelinePeak}</span>
                      <span>{formatDate(to)}</span>
                    </div>
                  </div>
                )}

                {/* Country breakdown */}
                {countryOptions.length > 1 && (
                  <div className="px-5 sm:px-7 pt-5">
                    <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                      By country <span className="font-medium normal-case tracking-normal">— click to filter</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                      {countryOptions.map(c => (
                        <button
                          key={c.country}
                          onClick={() => toggle(countries, c.country, setCountries)}
                          className={cn(
                            'text-left rounded-lg px-2 py-1.5 transition-colors',
                            countries.has(c.country) ? 'bg-slate-100' : 'hover:bg-slate-50',
                          )}
                        >
                          <div className="flex items-baseline justify-between text-xs mb-1">
                            <span className="font-semibold text-slate-700">{c.label}</span>
                            <span className="text-slate-400">
                              <span className="font-bold text-emerald-600">{c.done}</span> / {c.total}
                            </span>
                          </div>
                          <SegmentBar
                            total={c.total}
                            segments={[
                              { state: 'DONE', value: c.done },
                              { state: 'PARTIAL', value: c.partial },
                              { state: 'PENDING', value: c.pending },
                              { state: 'NA', value: c.na },
                            ]}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* The list */}
                <div className="px-5 sm:px-7 py-5">
                  <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                    Tours ({rows.length})
                    {states.size > 0 && rows.length !== counts.total && (
                      <span className="font-medium normal-case tracking-normal"> — filtered from {counts.total}</span>
                    )}
                  </h3>

                  {rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-14 text-slate-400">
                      <CircleAlert className="w-8 h-8 text-slate-300" />
                      <span className="text-sm">Nothing matches these filters</span>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {rows.map((r, i) => {
                        const state = stateForFocus(focus, r)
                        return (
                          <motion.div
                            key={r.bookingRef}
                            initial={reduce ? undefined : { opacity: 0, x: -8 }}
                            animate={reduce ? undefined : { opacity: 1, x: 0 }}
                            transition={reduce ? { duration: 0 } : { delay: Math.min(i, 20) * 0.015, duration: 0.22 }}
                            className={cn(
                              'group relative rounded-xl border bg-white px-3 py-2.5 hover:shadow-card transition-shadow',
                              'border-slate-200',
                            )}
                          >
                            {/* State rail down the left edge — scannable at a glance. */}
                            <span className={cn(
                              'absolute left-0 top-2 bottom-2 w-1 rounded-full',
                              STATE_STYLE[state].dot,
                            )} />

                            <div className="pl-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                              <a
                                href={`/dashboard/bookings/${r.bookingRef}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-xs font-bold text-brand-700 hover:underline inline-flex items-center gap-1"
                              >
                                {r.bookingRef}
                                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                              </a>

                              <span className="text-xs text-slate-700 font-medium truncate max-w-[180px]">
                                {r.leadPassenger || '—'}
                              </span>

                              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                {r.countryLabel} · {r.pax} pax · {r.totalDays}d
                              </span>

                              {/* Explains a row whose every check is N/A. */}
                              {r.hotelOnly && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-px rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold whitespace-nowrap"
                                  title="Hotel Only booking — accommodation only. No agenda, drivers, tickets, flights, client reconfirmation or QC."
                                >
                                  Hotel Only
                                </span>
                              )}

                              <span className="text-[11px] text-slate-500 whitespace-nowrap inline-flex items-center gap-1">
                                <PlaneLanding className="w-3 h-3 text-emerald-500" />
                                {formatDate(r.arrivalDate)}
                                <PlaneTakeoff className="w-3 h-3 text-sky-500 ml-1" />
                                {formatDate(r.departureDate)}
                              </span>

                              <span className="ml-auto flex items-center gap-1.5">
                                <StatePill
                                  state={state}
                                  text={textForFocus(focus, r)}
                                  title={detailForFocus(focus, r)}
                                />
                              </span>
                            </div>

                            <div className="pl-2.5 mt-1 text-[11px] text-slate-500">
                              {detailForFocus(focus, r)}
                              {/* On the reconfirmation view the permission is
                                  the missing half of the story — a guest who
                                  never accepted cannot be called at all. */}
                              {focus === 'reconfirm' && (
                                <span className="ml-2 text-slate-400">· {callDetail(r)}</span>
                              )}
                              {focus === 'reconfirm' && r.preTourCall?.requestedChange && (
                                <span className="ml-2 text-amber-700 font-medium">
                                  Change asked: {r.preTourCall.requestedChange}
                                </span>
                              )}
                              {meta.kind === 'movement' && !r.ready && (
                                <span className="ml-2 text-rose-600 font-medium">
                                  Missing: {r.outstanding.join(', ')}
                                </span>
                              )}
                            </div>
                          </motion.div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.div>
    </motion.div>,
    document.body,
  )
}
