'use client'

/**
 * Operations day board.
 *
 * Answers one question for a chosen date: **who is on the ground, and is each
 * tour actually ready?** Ready means four things, in the order ops chases them —
 * reconfirmation (client confirm or a pre-tour call), driver allocation, tickets
 * issued, and QC1 / QC2 signed off.
 *
 * There is deliberately no money on this page. Quotes, costs, profit and
 * balances live on the P&L and Profit pages; showing them here would put
 * commercial figures on a screen that is open on the ops floor all day.
 *
 * All three tabs (on ground / arrivals / departures) are slices of one fetch —
 * arrivals and departures are subsets of the on-ground set for that date — so
 * switching tabs is instant and the counts can never disagree.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Loader2, Download, Search, RefreshCw, CalendarDays, ChevronLeft, ChevronRight,
  PlaneLanding, PlaneTakeoff, Users, ChevronDown, MapPin, CircleAlert,
  Sparkles, Info, Maximize2, Hotel, XCircle, Ban, Clock, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { cn, formatDate, formatCurrency } from '@/lib/utils'
import type { OpsDayBoard, OpsDayRow } from '@/lib/reports/ops-day-data'
import type { ReadinessState } from '@/lib/booking-readiness'
import {
  CountUp, ProgressRing, SegmentBar, StateLegend, StatePill, STATE_STYLE,
  FOCUS_META, ReconfirmFacetBar, reconfirmState, reconfirmText, reconfirmDetail,
  callState, callText, callDetail, qcTick,
  type FocusKey,
} from './ops-board-parts'
import {
  APPROVAL_LABEL, countFacets, matchesFacets, type ReconfirmFacet,
} from '@/lib/reports/reconfirm-filters'
import { RECONFIRM_DUE_DAYS } from '@/lib/reconfirm-delay-shared'
import OpsDrilldown from './ops-drilldown'

// ─── Local helpers ────────────────────────────────────────────────────────────

type Segment = 'ONGROUND' | 'ARRIVALS' | 'DEPARTURES'

const SEGMENTS: { key: Segment; label: string; icon: typeof Users }[] = [
  { key: 'ONGROUND',   label: 'On Ground',  icon: Users },
  { key: 'ARRIVALS',   label: 'Arrivals',   icon: PlaneLanding },
  { key: 'DEPARTURES', label: 'Departures', icon: PlaneTakeoff },
]

/** `yyyy-mm-dd` today, in the browser's own timezone — good enough for a default. */
function todayLocal(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function weekdayShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

function dayOfMonth(date: string): string {
  return date.slice(8, 10)
}

/** Inclusive whole days between two `yyyy-mm-dd` dates. */
function daySpan(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return 1
  return Math.round((b - a) / 86_400_000) + 1
}

/** Last day of the month `date` falls in. */
function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** Mirrors MAX_WINDOW_DAYS in ops-day-data — the server clamps past this. */
const MAX_RANGE_DAYS = 92

const RANGE_PRESETS: { label: string; build: (today: string) => [string, string] }[] = [
  { label: 'Today',      build: t => [t, t] },
  { label: 'Next 7 days', build: t => [t, shift(t, 6)] },
  { label: 'This month',  build: t => [startOfMonth(t), endOfMonth(t)] },
  { label: 'Next 30 days', build: t => [t, shift(t, 29)] },
]

/**
 * How loud a waiting cancellation request is allowed to be.
 *
 * A request raised this morning is routine; one that has sat unanswered for
 * three days is holding ops hostage — drivers are being allocated and tickets
 * issued against a file that may be dead — so it escalates from amber to red
 * rather than sitting at one flat colour nobody re-reads.
 */
function waitTone(days: number | null): { ring: string; chip: string; text: string } {
  if (days != null && days >= 3) {
    return { ring: 'border-rose-300', chip: 'bg-rose-100 text-rose-800 border-rose-300', text: 'text-rose-700' }
  }
  if (days != null && days >= 1) {
    return { ring: 'border-orange-300', chip: 'bg-orange-100 text-orange-800 border-orange-300', text: 'text-orange-700' }
  }
  return { ring: 'border-amber-300', chip: 'bg-amber-100 text-amber-800 border-amber-300', text: 'text-amber-700' }
}

/** "today", "1 day", "4 days" — the age of a pending request, in words. */
function waitLabel(days: number | null): string {
  if (days == null) return 'waiting'
  if (days === 0) return 'raised today'
  return `waiting ${days} day${days === 1 ? '' : 's'}`
}

/** Row filters applied client-side, on top of what the server already scoped. */
type CheckFilter = 'ALL' | 'reconfirm' | 'calls' | 'driver' | 'tickets' | 'qc'

const CHECK_FILTERS: { key: CheckFilter; label: string }[] = [
  { key: 'ALL',       label: 'Any check' },
  { key: 'reconfirm', label: 'Reconfirm outstanding' },
  { key: 'calls',     label: 'Call request outstanding' },
  { key: 'driver',    label: 'Driver outstanding' },
  { key: 'tickets',   label: 'Tickets outstanding' },
  { key: 'qc',        label: 'QC outstanding' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OperationsBoardPage() {
  const { countryFilter } = useCountryFilter()
  const reduce = useReducedMotion()

  const [date, setDate] = useState(todayLocal())
  /** Range mode keeps its own pair so switching modes does not lose either one. */
  const [mode, setMode] = useState<'DAY' | 'RANGE'>('DAY')
  const [rangeFrom, setRangeFrom] = useState(todayLocal())
  const [rangeTo, setRangeTo] = useState(() => shift(todayLocal(), 6))
  const [search, setSearch] = useState('')
  const [board, setBoard] = useState<OpsDayBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [segment, setSegment] = useState<Segment>('ONGROUND')
  const [onlyOutstanding, setOnlyOutstanding] = useState(false)
  const [checkFilter, setCheckFilter] = useState<CheckFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  /** Reconfirmation chips: OR inside a group, AND across groups. */
  const [facets, setFacets] = useState<Set<ReconfirmFacet>>(new Set())
  const [countryRowFilter, setCountryRowFilter] = useState('ALL')
  /** Narrow the whole board to files whose cancellation accounts has not decided. */
  const [cancelOnly, setCancelOnly] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  /** Which card the drill-down is open on; null when it is closed. */
  const [focus, setFocus] = useState<FocusKey | null>(null)

  // The window actually queried. A reversed range is swapped here so the inputs
  // stay forgiving; the server swaps too, but the labels below need it as well.
  const [from, to] = mode === 'DAY'
    ? [date, date]
    : rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom]

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (search.trim()) params.set('search', search.trim())
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)

      const res = await fetch(`/api/accounts/report/ops?${params}`)
      const json = await res.json()
      if (json.success) setBoard(json.data as OpsDayBoard)
      else toast.error(json.error ?? 'Failed to load the board')
    } catch {
      toast.error('Failed to load the board')
    } finally {
      setLoading(false)
    }
  }, [from, to, search, countryFilter])

  // Date and country reload immediately; the search box is debounced so typing a
  // booking ref does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { load() }, search ? 350 : 0)
    return () => clearTimeout(t)
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setExpanded(null) }, [segment, from, to])

  /** Status and country choices come from the loaded window, so the dropdowns
   *  only ever offer values that can actually match something. */
  const statusOptions = useMemo(() => {
    const set = new Map<string, string>()
    for (const r of board?.rows ?? []) set.set(r.status, r.statusLabel)
    return Array.from(set, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [board])

  const countryOptions = useMemo(
    () => (board?.summary.byCountry ?? []).map(c => ({ value: c.country, label: c.label })),
    [board],
  )

  // A dropped option (window changed, value no longer present) falls back to All
  // rather than silently filtering the list down to nothing.
  useEffect(() => {
    if (statusFilter !== 'ALL' && !statusOptions.some(o => o.value === statusFilter)) {
      setStatusFilter('ALL')
    }
  }, [statusOptions, statusFilter])

  useEffect(() => {
    if (countryRowFilter !== 'ALL' && !countryOptions.some(o => o.value === countryRowFilter)) {
      setCountryRowFilter('ALL')
    }
  }, [countryOptions, countryRowFilter])

  const outstandingCheck = useCallback((r: OpsDayRow): boolean => {
    switch (checkFilter) {
      case 'reconfirm': return reconfirmState(r) !== 'DONE'
      case 'calls':     return callState(r) !== 'DONE' && callState(r) !== 'NA'
      case 'driver':    return r.driver.state !== 'DONE' && r.driver.state !== 'NA'
      case 'tickets':   return r.tickets.state !== 'DONE' && r.tickets.state !== 'NA'
      case 'qc':        return r.qc.state !== 'DONE' && r.qc.state !== 'NA'
      default:          return true
    }
  }, [checkFilter])

  /**
   * Everything the board shows *except* the reconfirmation chips. The chip
   * counts read from here, so narrowing to "not confirmed" leaves the other
   * chips still describing the whole day rather than collapsing to themselves.
   */
  const preFacet = useMemo(() => (board?.rows ?? []).filter(r => {
    if (segment === 'ARRIVALS' && !r.isArrival) return false
    if (segment === 'DEPARTURES' && !r.isDeparture) return false
    if (onlyOutstanding && r.ready) return false
    if (cancelOnly && !r.cancelPending) return false
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
    if (countryRowFilter !== 'ALL' && r.country !== countryRowFilter) return false
    return outstandingCheck(r)
  }), [board, segment, onlyOutstanding, cancelOnly, statusFilter, countryRowFilter, outstandingCheck])

  const facetCounts = useMemo(() => countFacets(preFacet), [preFacet])

  const visible = useMemo(
    () => facets.size ? preFacet.filter(r => matchesFacets(facets, r)) : preFacet,
    [preFacet, facets],
  )

  const filtersActive =
    onlyOutstanding || cancelOnly || checkFilter !== 'ALL' || statusFilter !== 'ALL'
    || countryRowFilter !== 'ALL' || search.trim().length > 0 || facets.size > 0

  function clearFilters() {
    setOnlyOutstanding(false)
    setCancelOnly(false)
    setCheckFilter('ALL')
    setStatusFilter('ALL')
    setCountryRowFilter('ALL')
    setSearch('')
    setFacets(new Set())
  }

  function toggleFacet(key: ReconfirmFacet) {
    setFacets(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /**
   * The visible rows minus the cancellations.
   *
   * Cancelled bookings are listed on the board — the desk asked to see that the
   * file it was working is dead rather than have it silently vanish — but there
   * is no work left on one, so they are excluded from every gauge, the ready
   * percentage and the D-10 chase. Counting them would make a day of
   * cancellations read as a day fully under control.
   */
  const liveVisible = useMemo(() => visible.filter(r => !r.cancelled), [visible])
  const cancelledCount = visible.length - liveVisible.length

  /**
   * Files whose cancellation the accounts team has not answered yet.
   *
   * Read from the whole loaded window rather than the filtered list on purpose:
   * this is an alert, and an alert that disappears because somebody switched to
   * the Arrivals tab is an alert nobody can rely on. The board still runs its
   * own filters underneath — the panel is what makes sure the request is seen at
   * all. Oldest request first: the one that has waited longest is the one
   * blocking the most work.
   */
  const cancelQueue = useMemo(() => (board?.rows ?? [])
    .filter(r => r.cancelPending)
    .sort((a, b) =>
      (b.cancellation?.waitingDays ?? 0) - (a.cancellation?.waitingDays ?? 0)
      || a.arrivalDate.localeCompare(b.arrivalDate)),
    [board])

  const cancelQueuePax = cancelQueue.reduce((s, r) => s + r.pax, 0)
  const cancelQueueFee = cancelQueue.reduce((s, r) => s + (r.cancellation?.feeTotal ?? 0), 0)
  /** The oldest wait in the queue — what the headline chip escalates on. */
  const cancelQueueOldest = cancelQueue.reduce<number | null>(
    (m, r) => {
      const d = r.cancellation?.waitingDays
      return d == null ? m : m == null ? d : Math.max(m, d)
    }, null)

  /**
   * Jump the board to the approval queue. Clearing the other filters first is
   * deliberate: "show me these five files" must show five files, not five minus
   * whatever an Outstanding-only tick left behind.
   */
  function focusCancelQueue() {
    if (cancelOnly) { setCancelOnly(false); return }
    setOnlyOutstanding(false)
    setCheckFilter('ALL')
    setStatusFilter('ALL')
    setFacets(new Set())
    setSegment('ONGROUND')
    setCancelOnly(true)
  }

  // ── The four gauges ────────────────────────────────────────────────────────
  // Computed over the *visible* rows so the rings describe exactly the list
  // underneath them; switching to Arrivals re-scopes the whole board.
  const gauges = useMemo(() => {
    const tally = (pick: (r: OpsDayRow) => ReadinessState) => {
      const counts: Record<ReadinessState, number> = { DONE: 0, PARTIAL: 0, PENDING: 0, NA: 0 }
      for (const r of liveVisible) counts[pick(r)] += 1
      // N/A rows are excluded from the denominator: a tour with no tickets to
      // buy should not drag the "tickets issued" gauge down.
      const scope = counts.DONE + counts.PARTIAL + counts.PENDING
      // A partially-covered file counts as *done* on these gauges.
      //
      // The desk reads a card to answer one question: how much of today still
      // needs somebody to act? A file where the guest has been reconfirmed by
      // one of the two accepted routes, or where some transfers already have a
      // driver, is not work waiting to start — it is work in hand. Scoring it as
      // half a file (the old `PARTIAL * 0.5`) put the ring between the two
      // readings and matched neither, and showing only `DONE` in the numerator
      // made a day that was 99/109 handled look like 18/109.
      //
      // So `covered` is the numerator and `PENDING` is the outstanding work. The
      // amber band keeps its own figure in the legend, under the label "Done" —
      // still visible as a distinct number, but on the finished side of the
      // line. Row chips and the drill-down still say "Partial", because there
      // the distinction between the two is the entire point of the view.
      const covered = counts.DONE + counts.PARTIAL
      const pct = scope > 0 ? (covered / scope) * 100 : 0
      const state: ReadinessState = scope === 0 ? 'NA'
        : covered === scope ? 'DONE'
          : covered > 0 ? 'PARTIAL' : 'PENDING'
      return { counts, scope, covered, pct, state }
    }

    // Labels and icons come from FOCUS_META so the card and the drill-down it
    // opens are guaranteed to describe the same thing.
    return ([
      ['reconfirm', reconfirmState],
      ['calls', callState],
      ['driver', (r: OpsDayRow) => r.driver.state],
      ['tickets', (r: OpsDayRow) => r.tickets.state],
      ['qc', (r: OpsDayRow) => r.qc.state],
    ] as [FocusKey, (r: OpsDayRow) => ReadinessState][])
      .map(([key, pick]) => ({ key, ...FOCUS_META[key], ...tally(pick) }))
  }, [liveVisible])

  const readyCount = liveVisible.filter(r => r.ready).length
  const readyPct = liveVisible.length ? Math.round((readyCount / liveVisible.length) * 100) : 0
  /** Accommodation-only files in view — ready by definition, not by work done. */
  const hotelOnlyCount = liveVisible.filter(r => r.hotelOnly).length

  /**
   * The D-10 reconfirmation deadline across the visible rows.
   *
   * `unexplained` is the number that earns a place on the readiness strip:
   * a late file somebody has accounted for is a known problem, while a late
   * file nobody has written a word about is an unknown one, and the strip is
   * read to find out which kind of day it is.
   */
  const d10 = useMemo(() => ({
    breached: liveVisible.filter(r => r.reconfirmBreached).length,
    unexplained: liveVisible.filter(r => r.reconfirmBreached && !r.reconfirmDelay).length,
    stale: liveVisible.filter(r => r.reconfirmDelay?.stale).length,
  }), [liveVisible])

  // A week rail centred two days back, so yesterday's loose ends stay one click away.
  const railDays = useMemo(
    () => Array.from({ length: 9 }, (_, i) => shift(date, i - 4)),
    [date],
  )
  const today = todayLocal()
  const spanDays = daySpan(from, to)
  const overMax = spanDays > MAX_RANGE_DAYS

  /** Step the whole range by its own length, so paging never changes the span. */
  function shiftRange(dir: 1 | -1) {
    const step = spanDays * dir
    setRangeFrom(shift(from, step))
    setRangeTo(shift(to, step))
  }

  function applyPreset(build: (t: string) => [string, string]) {
    const [f, t] = build(today)
    setRangeFrom(f)
    setRangeTo(t)
  }

  function exportCSV() {
    if (!visible.length) { toast.error('Nothing to export'); return }
    const headers = [
      'Booking Ref', 'Booking Type', 'Lead Passenger', 'Agent', 'File Handler', 'Country', 'Destination',
      'Status', 'Arrival', 'Departure', 'Day', 'Pax',
      'On Board Date', 'Client Confirmed', 'Pre-Tour Call', 'Call Outcome',
      'WhatsApp Call Request', 'Request Sent', 'Accepted On', 'Call Scheduled', 'Call Schedule Status',
      'Driver Allocation', 'Tickets', 'QC Stage', 'QC1', 'QC2', 'Outstanding',
      'Cancel Approval', 'Cancel Requested On', 'Cancel Requested By', 'Days Awaiting Approval',
      'Cancel Reason', 'Cancellation Fee',
      'D-10 Due', 'D-10 Status', 'Days Late', 'Delay Reason', 'Delay Detail', 'Reason Recorded By', 'Reason Recorded On',
    ]
    const lines = visible.map(r => [
      r.bookingRef,
      r.cancelled ? 'CANCELLED' : r.hotelOnly ? 'Hotel Only' : 'Full tour',
      r.leadPassenger ?? '', r.agent ?? '', r.fileHandler ?? '',
      r.countryLabel, r.destination ?? '', r.statusLabel,
      r.arrivalDate, r.departureDate, `${r.dayNo}/${r.totalDays}`, r.pax,
      r.cancelled ? 'Cancelled' : r.isArrival ? 'Arriving' : r.isDeparture ? 'Departing' : r.hotelOnly ? 'In hotel' : 'On tour',
      r.hotelOnly ? 'N/A — Hotel Only' : r.clientConfirmed ? 'Yes' : 'No',
      r.preTourCall ? `Yes (${r.preTourCall.at})` : 'No',
      r.preTourCall?.outcome ?? '',
      APPROVAL_LABEL[r.call.approval],
      r.call.approvalRequestedAt?.slice(0, 10) ?? '',
      r.call.approvedAt?.slice(0, 10) ?? '',
      r.call.scheduledAt?.slice(0, 10) ?? '',
      r.call.scheduleStatus ?? '',
      r.driver.short, r.tickets.short, r.qc.short,
      qcTick(r, 1) === 'DONE' ? 'Pass' : 'Pending',
      qcTick(r, 2) === 'DONE' ? 'Pass' : 'Pending',
      r.outstanding.join('; ') || 'None',
      // Exported next to the checks on purpose: a spreadsheet can then answer
      // "what did we allocate against files that were being cancelled".
      r.cancelPending ? 'AWAITING APPROVAL' : r.cancelled ? 'Approved / cancelled' : '',
      r.cancellation?.requestedAt?.slice(0, 10) ?? '',
      r.cancellation?.requestedBy ?? '',
      r.cancelPending ? r.cancellation?.waitingDays ?? '' : '',
      r.cancellation?.reason ?? '',
      r.cancellation?.feeTotal ?? '',
      // The D-10 block is exported alongside the checks so a spreadsheet can be
      // pivoted by reason — "how many files did we lose to unpaid balances last
      // month" is a question the board itself cannot answer.
      r.reconfirmStanding.dueAt,
      r.reconfirmStanding.state,
      r.reconfirmBreached ? Math.abs(r.reconfirmStanding.daysToDue) : '',
      r.reconfirmBreached ? (r.reconfirmDelay?.reasonLabel ?? 'NO REASON RECORDED') : '',
      r.reconfirmDelay?.note ?? '',
      r.reconfirmDelay?.recordedBy ?? '',
      r.reconfirmDelay?.recordedAt?.slice(0, 10) ?? '',
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))

    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ops-board-${from}${from === to ? '' : `_to_${to}`}-${segment.toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${visible.length} tours`)
  }

  const fade = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Header
        title="Operations Board"
        subtitle={board ? `${board.label}${board.isToday ? ' · today' : ''} · ${board.timezone}` : 'Loading…'}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => load({ silent: true })}
              className="btn btn-secondary btn-sm"
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button onClick={exportCSV} className="btn btn-primary btn-sm">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        }
      />

      <div className="p-4 sm:p-8 space-y-6">

        {/* ── Date rail / range picker ────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardBody className="p-3 sm:p-4 space-y-3">

            {/* Day vs range. Both keep their own dates, so toggling back and
                forth never loses what was set on the other side. */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                {([['DAY', 'Single day'], ['RANGE', 'Date range']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    className={cn(
                      'relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                      mode === key ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
                    )}
                  >
                    {mode === key && (
                      <motion.span
                        layoutId="date-mode-pill"
                        className="absolute inset-0 rounded-lg bg-white shadow-sm"
                        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-500">
                {board?.label ?? `${formatDate(from)}${from === to ? '' : ` → ${formatDate(to)}`}`}
                {spanDays > 1 && (
                  <span className="ml-2 font-semibold text-slate-700">{spanDays} days</span>
                )}
              </span>
              {overMax && (
                <span className="text-[11px] font-semibold text-amber-700">
                  Capped at {MAX_RANGE_DAYS} days — showing {from} → {shift(from, MAX_RANGE_DAYS - 1)}
                </span>
              )}
              {board?.truncated && (
                <span className="text-[11px] font-semibold text-amber-700">
                  Row cap reached — narrow the window for a complete picture
                </span>
              )}
            </div>

            {mode === 'RANGE' ? (
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <button
                  onClick={() => shiftRange(-1)}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  title={`Previous ${spanDays} days`}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-slate-400" />
                  <input
                    type="date"
                    className="form-input py-1.5 text-xs w-36"
                    value={rangeFrom}
                    max={rangeTo}
                    onChange={e => e.target.value && setRangeFrom(e.target.value)}
                  />
                  <span className="text-slate-400 text-xs">→</span>
                  <input
                    type="date"
                    className="form-input py-1.5 text-xs w-36"
                    value={rangeTo}
                    min={rangeFrom}
                    onChange={e => e.target.value && setRangeTo(e.target.value)}
                  />
                </div>

                <button
                  onClick={() => shiftRange(1)}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  title={`Next ${spanDays} days`}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>

                <div className="flex flex-wrap items-center gap-1.5 sm:pl-3 sm:border-l border-slate-200">
                  {RANGE_PRESETS.map(p => {
                    const [pf, pt] = p.build(today)
                    const active = pf === from && pt === to
                    return (
                      <button
                        key={p.label}
                        onClick={() => applyPreset(p.build)}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors',
                          active
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                        )}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setDate(d => shift(d, -1))}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors flex-shrink-0"
                title="Previous day"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1">
                {railDays.map(d => {
                  const active = d === date
                  return (
                    <button
                      key={d}
                      onClick={() => setDate(d)}
                      className={cn(
                        'relative flex-shrink-0 w-14 sm:w-16 py-2 rounded-xl text-center transition-colors',
                        active ? 'text-white' : 'text-slate-500 hover:bg-slate-100',
                        !active && d === today && 'text-brand-700 font-semibold',
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="date-pill"
                          className="absolute inset-0 rounded-xl bg-slate-900 shadow-lg"
                          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      )}
                      <span className="relative block text-[10px] uppercase tracking-wide opacity-80">
                        {weekdayShort(d)}
                      </span>
                      <span className="relative block text-lg font-bold leading-tight">
                        {dayOfMonth(d)}
                      </span>
                      {d === today && (
                        <span className={cn(
                          'relative block w-1 h-1 rounded-full mx-auto mt-0.5',
                          active ? 'bg-brand-400' : 'bg-brand-500',
                        )} />
                      )}
                    </button>
                  )
                })}
              </div>

              <button
                onClick={() => setDate(d => shift(d, 1))}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors flex-shrink-0"
                title="Next day"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              <div className="hidden md:flex items-center gap-2 pl-3 border-l border-slate-200 flex-shrink-0">
                <CalendarDays className="w-4 h-4 text-slate-400" />
                <input
                  type="date"
                  className="form-input py-1.5 text-xs w-36"
                  value={date}
                  onChange={e => e.target.value && setDate(e.target.value)}
                />
                <button
                  onClick={() => setDate(today)}
                  disabled={date === today}
                  className="btn btn-secondary btn-sm disabled:opacity-40"
                >
                  Today
                </button>
              </div>
            </div>
            )}
          </CardBody>
        </Card>

        {/* ── Hero counts ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              key: 'ONGROUND' as Segment, focus: 'onground' as FocusKey, label: 'On Ground', icon: Users,
              value: board?.summary.onGround ?? 0, pax: board?.summary.paxOnGround ?? 0,
              from: 'from-navy-600', to: 'to-navy-800',
            },
            {
              key: 'ARRIVALS' as Segment, focus: 'arrivals' as FocusKey, label: 'Arrivals', icon: PlaneLanding,
              value: board?.summary.arrivals ?? 0, pax: board?.summary.paxArriving ?? 0,
              from: 'from-emerald-500', to: 'to-emerald-700',
            },
            {
              key: 'DEPARTURES' as Segment, focus: 'departures' as FocusKey, label: 'Departures', icon: PlaneTakeoff,
              value: board?.summary.departures ?? 0, pax: board?.summary.paxDeparting ?? 0,
              from: 'from-sky-500', to: 'to-sky-700',
            },
          ].map((k, i) => (
            <motion.div
              key={k.key}
              {...fade}
              transition={reduce ? { duration: 0 } : { delay: i * 0.06, duration: 0.35 }}
              whileHover={reduce ? undefined : { y: -3 }}
              className={cn(
                'relative rounded-2xl overflow-hidden bg-gradient-to-br text-white shadow-lg transition-shadow',
                k.from, k.to,
                segment === k.key ? 'ring-2 ring-offset-2 ring-slate-900' : 'hover:shadow-xl',
              )}
            >
              {/* Decorative wash — keeps the tiles from reading as flat blocks. */}
              <span className="absolute -right-6 -top-8 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
              <span className="absolute -right-12 top-6 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />

              {/* The tile body switches the list below; the corner button opens
                  the drill-down. Two actions, so the tile is not a single button. */}
              <button onClick={() => setSegment(k.key)} className="relative w-full text-left p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-white/70 font-semibold">{k.label}</div>
                    <div className="text-4xl font-extrabold leading-none mt-2">
                      <CountUp value={k.value} />
                    </div>
                    <div className="text-xs text-white/80 mt-2 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      <CountUp value={k.pax} /> pax
                    </div>
                  </div>
                  <k.icon className="w-8 h-8 text-white/40 mr-8" />
                </div>
              </button>

              <button
                onClick={() => setFocus(k.focus)}
                title={`Open ${k.label} detail`}
                className="absolute right-3 top-3 p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/15 transition-colors"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </div>

        {/* ── Cancellation approvals pending ──────────────────────────────── */}
        {/*
            Sits directly under the hero counts because of what it means: every
            file listed here is inside those counts — being driven, ticketed and
            QC'd — while somebody has already asked for it to be cancelled. The
            board's job is to make sure nobody spends another day on a tour that
            accounts is about to call off.
        */}
        <AnimatePresence initial={false}>
          {cancelQueue.length > 0 && (
            <motion.div
              {...fade}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={reduce ? { duration: 0 } : { delay: 0.1, duration: 0.35 }}
              className={cn(
                'relative overflow-hidden rounded-2xl border-2 bg-white shadow-card',
                waitTone(cancelQueueOldest).ring,
              )}
            >
              {/* A quiet diagonal wash, so the panel reads as an alert strip
                  rather than yet another white card in the stack. */}
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-rose-50 via-orange-50/60 to-transparent" />

              <div className="relative p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border',
                      waitTone(cancelQueueOldest).chip,
                    )}>
                      <Ban className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                        Cancellation approvals pending
                        <span className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold',
                          waitTone(cancelQueueOldest).chip,
                        )}>
                          <CountUp value={cancelQueue.length} />
                          <span className="ml-1 font-semibold">
                            file{cancelQueue.length === 1 ? '' : 's'}
                          </span>
                        </span>
                      </h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600 max-w-2xl">
                        These bookings are still counted as live above — drivers, tickets and QC are
                        still being chased on them — but a cancellation has been requested and the
                        accounts team has not decided yet. Approve or reject in the Apple Accounts
                        system; this board is read-only.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-slate-400" />
                          <strong className="text-slate-800">{cancelQueuePax}</strong> pax affected
                        </span>
                        {cancelQueueFee > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <CircleAlert className="h-3 w-3 text-slate-400" />
                            <strong className="text-slate-800">
                              {formatCurrency(cancelQueueFee, cancelQueue[0]?.cancellation?.currency ?? 'USD')}
                            </strong> in cancellation fees claimed
                          </span>
                        )}
                        {cancelQueueOldest != null && (
                          <span className={cn('inline-flex items-center gap-1 font-semibold', waitTone(cancelQueueOldest).text)}>
                            <Clock className="h-3 w-3" />
                            oldest {waitLabel(cancelQueueOldest)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={focusCancelQueue}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors',
                      cancelOnly
                        ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    {cancelOnly ? 'Show the whole board' : 'Show only these on the board'}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {cancelQueue.map(r => {
                    const c = r.cancellation
                    const tone = waitTone(c?.waitingDays ?? null)
                    return (
                      <div
                        key={r.bookingRef}
                        className={cn(
                          'rounded-xl border bg-white/90 p-3 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md',
                          tone.ring,
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <a
                            href={`/dashboard/bookings/${r.bookingRef}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-sm font-bold text-brand-700 hover:underline"
                          >
                            {r.bookingRef}
                            <ExternalLink className="h-3 w-3 text-slate-400" />
                          </a>
                          <span className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                            tone.chip,
                          )}>
                            <Clock className="h-2.5 w-2.5" />
                            {waitLabel(c?.waitingDays ?? null)}
                          </span>
                        </div>

                        <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
                          <div className="truncate" title={r.leadPassenger ?? ''}>
                            {r.leadPassenger || '—'}
                            <span className="text-slate-400"> · {r.pax} pax · {r.countryLabel}</span>
                          </div>
                          <div>
                            {formatDate(r.arrivalDate)} → {formatDate(r.departureDate)}
                            <span className="text-slate-400"> · day {r.dayNo}/{r.totalDays}</span>
                          </div>
                          <div className="text-slate-400 truncate">
                            Requested by {c?.requestedBy || 'unknown'}
                            {c?.heldAtLabel ? ` · held at ${c.heldAtLabel}` : ''}
                          </div>
                        </div>

                        {c?.reason && (
                          <p
                            className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] italic text-slate-600 line-clamp-2"
                            title={c.reason}
                          >
                            “{c.reason}”
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {c?.feeTotal != null && c.feeTotal > 0 && (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                              Fee {formatCurrency(c.feeTotal, c.currency ?? 'USD')}
                            </span>
                          )}
                          {/* What is still being spent on a file that may die —
                              the reason this panel is on an ops board at all. */}
                          {r.driver.state !== 'NA' && r.driver.state !== 'PENDING' && (
                            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              Drivers {r.driver.short}
                            </span>
                          )}
                          {r.tickets.state === 'DONE' && (
                            <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">
                              Tickets issued
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Readiness gauges ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {gauges.map((g, i) => (
            <motion.button
              key={g.key}
              {...fade}
              transition={reduce ? { duration: 0 } : { delay: 0.15 + i * 0.06, duration: 0.35 }}
              whileHover={reduce ? undefined : { y: -3 }}
              onClick={() => setFocus(g.key)}
              title={`Open ${g.label} detail`}
              className="group relative text-left bg-white rounded-2xl border border-slate-200 shadow-card p-4 hover:shadow-card-hover hover:border-slate-300 transition-all"
            >
              <Maximize2 className="absolute right-3 top-3 w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
              <div className="flex items-center gap-4">
                <ProgressRing pct={g.pct} color={STATE_STYLE[g.state].ring}>
                  <span className="text-sm font-extrabold text-slate-900 leading-none">
                    <CountUp value={g.covered} />
                    <span className="text-slate-400 font-semibold">/{g.scope}</span>
                  </span>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <g.icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-sm font-bold text-slate-900 truncate">{g.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug pr-4">{g.hint}</p>
                  <div className="mt-2 space-y-1.5">
                    <SegmentBar
                      total={visible.length}
                      segments={[
                        { state: 'DONE', value: g.counts.DONE },
                        { state: 'PARTIAL', value: g.counts.PARTIAL, label: 'Done' },
                        { state: 'PENDING', value: g.counts.PENDING },
                        { state: 'NA', value: g.counts.NA },
                      ]}
                    />
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                      {g.counts.PARTIAL > 0 && <span className="text-amber-600 font-semibold">{g.counts.PARTIAL} Done</span>}
                      {g.counts.PENDING > 0 && <span className="text-rose-600 font-semibold">{g.counts.PENDING} pending</span>}
                      {g.counts.NA > 0 && <span>{g.counts.NA} n/a</span>}
                      {g.counts.PENDING === 0 && g.scope > 0 && (
                        <span className="text-emerald-600 font-semibold">All clear</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.button>
          ))}
        </div>

        {/* ── Overall readiness strip ─────────────────────────────────────── */}
        <motion.div
          {...fade}
          transition={reduce ? { duration: 0 } : { delay: 0.4, duration: 0.35 }}
          className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 flex flex-wrap items-center gap-x-6 gap-y-3"
        >
          <div className="flex items-center gap-2">
            <Sparkles className={cn('w-4 h-4', readyPct === 100 ? 'text-emerald-500' : 'text-brand-500')} />
            <span className="text-sm font-bold text-slate-900">
              <CountUp value={readyCount} /> of {visible.length} fully ready
            </span>
          </div>
          <div className="flex-1 min-w-[180px] h-2 rounded-full bg-slate-100 overflow-hidden">
            <motion.div
              className={cn('h-full rounded-full', readyPct === 100 ? 'bg-emerald-500' : 'bg-brand-500')}
              initial={{ width: 0 }}
              animate={{ width: `${readyPct}%` }}
              transition={reduce ? { duration: 0 } : { duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <span className="text-sm font-extrabold text-slate-900 tabular-nums">{readyPct}%</span>
          {/* Hotel Only files count as ready because nothing is outstanding on
              them. Saying how many there are stops the percentage reading as a
              better day than it was. */}
          {hotelOnlyCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold"
              title="Accommodation-only bookings. Every check is N/A on these, so they count as ready."
            >
              <Hotel className="w-3 h-3" />
              {hotelOnlyCount} Hotel Only
            </span>
          )}
          {/* Cancellations are on the board but excluded from the percentage —
              say how many, so the ready count is read against the right total. */}
          {cancelledCount > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'CANCELLED' ? 'ALL' : 'CANCELLED')}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors',
                statusFilter === 'CANCELLED'
                  ? 'bg-rose-100 text-rose-800 border-rose-300'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
              )}
              title="Cancelled bookings in view. They are listed so the desk can see what happened to the file, but they carry no outstanding work and are left out of every count above."
            >
              <XCircle className="w-3 h-3" />
              {cancelledCount} Cancelled
            </button>
          )}
          {/* Pending cancellations *are* counted in the percentage — they are
              live files until accounts decides — so the strip says how much of
              the day's readiness is being spent on work that may be called off. */}
          {cancelQueue.length > 0 && (
            <button
              type="button"
              onClick={focusCancelQueue}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors',
                cancelOnly
                  ? 'bg-slate-900 text-white border-slate-900'
                  : cn(waitTone(cancelQueueOldest).chip, 'hover:brightness-95'),
              )}
              title={
                `${cancelQueue.length} booking(s) have a cancellation request waiting on the accounts team. `
                + 'They are still counted as live above — click to see only those files.'
              }
            >
              <Ban className="w-3 h-3" />
              {cancelQueue.length} awaiting cancel approval
              {cancelQueueOldest != null && cancelQueueOldest >= 1 && (
                <span className="opacity-70">· oldest {cancelQueueOldest}d</span>
              )}
            </button>
          )}
          {/* The D-10 pill is a control, not an ornament: clicking it filters
              the board down to exactly the files it is complaining about, which
              is the next thing anyone reading the number wants to do. */}
          {d10.breached > 0 && (
            <button
              type="button"
              onClick={() => toggleFacet(d10.unexplained > 0 ? 'DELAY_UNEXPLAINED' : 'DELAY_EXPLAINED')}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors',
                d10.unexplained > 0
                  ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
              )}
              title={
                `${d10.breached} booking(s) are past the D-${RECONFIRM_DUE_DAYS} guest reconfirmation deadline. `
                + (d10.unexplained > 0
                  ? `${d10.unexplained} of them have no recorded reason — click to see only those.`
                  : 'Every one of them has a recorded reason — click to see them.')
                + (d10.stale > 0 ? ` ${d10.stale} reason(s) have not been updated in days.` : '')
              }
            >
              <CircleAlert className="w-3 h-3" />
              {d10.unexplained > 0
                ? `${d10.unexplained} D-${RECONFIRM_DUE_DAYS} unexplained`
                : `${d10.breached} D-${RECONFIRM_DUE_DAYS} late`}
              {d10.stale > 0 && (
                <span className="opacity-70">· {d10.stale} stale</span>
              )}
            </button>
          )}
          <StateLegend />
        </motion.div>

        {/* ── Reconfirmation filter chips ─────────────────────────────────── */}
        <motion.div {...fade} transition={reduce ? { duration: 0 } : { delay: 0.45, duration: 0.35 }}>
          <ReconfirmFacetBar
            selected={facets}
            counts={facetCounts}
            total={preFacet.length}
            onToggle={toggleFacet}
            onClear={() => setFacets(new Set())}
            approvalUnavailable={board ? !board.approvalDataAvailable : false}
          />
        </motion.div>

        {board && !board.approvalDataAvailable && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              The WhatsApp call-approval ledger could not be read — call request
              filters will not match anything until it is available again.
            </span>
          </div>
        )}

        {board && !board.callDataAvailable && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Pre-tour call records are unavailable on this environment — reconfirmation
              falls back to the client-confirm status only.
            </span>
          </div>
        )}

        {/* ── The list ────────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardHeader
            action={
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                    checked={onlyOutstanding}
                    onChange={e => setOnlyOutstanding(e.target.checked)}
                  />
                  Outstanding only
                </label>

                <select
                  className="form-input py-1.5 text-xs w-40"
                  value={checkFilter}
                  onChange={e => setCheckFilter(e.target.value as CheckFilter)}
                  title="Show only tours where this check is not clear"
                >
                  {CHECK_FILTERS.map(f => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>

                <select
                  className="form-input py-1.5 text-xs w-36"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  title="Booking status"
                >
                  <option value="ALL">All statuses</option>
                  {statusOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {countryOptions.length > 1 && (
                  <select
                    className="form-input py-1.5 text-xs w-32"
                    value={countryRowFilter}
                    onChange={e => setCountryRowFilter(e.target.value)}
                    title="Country"
                  >
                    <option value="ALL">All countries</option>
                    {countryOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}

                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    className="form-input pl-8 py-1.5 text-xs w-52"
                    placeholder="Ref, agent, passenger…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                {filtersActive && (
                  <button onClick={clearFilters} className="btn btn-secondary btn-sm">
                    Clear filters
                  </button>
                )}
              </div>
            }
          >
            {/* Segment switcher with a sliding indicator. */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100">
              {SEGMENTS.map(s => {
                const active = segment === s.key
                const count = s.key === 'ARRIVALS' ? board?.summary.arrivals
                  : s.key === 'DEPARTURES' ? board?.summary.departures
                    : board?.summary.onGround
                return (
                  <button
                    key={s.key}
                    onClick={() => setSegment(s.key)}
                    className={cn(
                      'relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                      active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="segment-pill"
                        className="absolute inset-0 rounded-lg bg-white shadow-sm"
                        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative flex items-center gap-1.5">
                      <s.icon className="w-3.5 h-3.5" />
                      {s.label}
                      <span className="text-[10px] font-bold text-slate-400">{count ?? 0}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </CardHeader>

          <CardBody className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
                <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
                <span className="text-xs">Building the board…</span>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
                <CircleAlert className="w-8 h-8 text-slate-300" />
                <span className="text-sm">
                  {onlyOutstanding
                    ? 'Nothing outstanding — every tour on this list is ready'
                    : filtersActive
                      ? 'No tours match these filters'
                      : `No tours in ${from === to ? 'this day' : 'this date range'}`}
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {[
                        'Booking', 'Lead Pax', 'Day', 'Pax', 'Movement',
                        'Reconfirm', 'Call Request', 'Driver', 'Tickets', 'QC1', 'QC2', '',
                      ].map(h => (
                        <th
                          key={h}
                          className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((r, i) => {
                      const open = expanded === r.bookingRef
                      return (
                        <Fragment key={r.bookingRef}>
                          <motion.tr
                            initial={reduce ? undefined : { opacity: 0, y: 6 }}
                            animate={reduce ? undefined : { opacity: 1, y: 0 }}
                            // Cap the stagger so a 200-row day still finishes fast.
                            transition={reduce ? { duration: 0 } : { delay: Math.min(i, 15) * 0.02, duration: 0.25 }}
                            onClick={() => setExpanded(open ? null : r.bookingRef)}
                            className={cn(
                              'cursor-pointer transition-colors',
                              open ? 'bg-slate-50'
                                // A cancelled file is greyed and struck through:
                                // still on the board so the desk sees what
                                // happened to it, visibly not work in progress.
                                : r.cancelled ? 'bg-slate-100/70 text-slate-400 hover:bg-slate-100'
                                  // A file with a cancellation waiting on accounts
                                  // is still live work, so it keeps its full
                                  // colour — but it is striped so the desk cannot
                                  // scroll past it without noticing.
                                  : r.cancelPending ? 'bg-orange-50/70 hover:bg-orange-50'
                                  // Hotel Only rows are tinted rather than hidden:
                                  // the guest is on the ground and ops must see
                                  // them, but nothing on the row is a chase.
                                  : r.hotelOnly ? 'bg-amber-50/40 hover:bg-amber-50'
                                    : 'hover:bg-slate-50',
                            )}
                          >
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                                  r.cancelled ? 'bg-slate-400'
                                    : r.cancelPending ? 'bg-orange-500 animate-pulse'
                                      : r.hotelOnly ? 'bg-amber-400' : r.ready ? 'bg-emerald-500' : 'bg-rose-500',
                                )} />
                                <a
                                  href={`/dashboard/bookings/${r.bookingRef}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className={cn(
                                    'font-mono font-bold hover:underline',
                                    r.cancelled ? 'text-slate-500 line-through' : 'text-brand-700',
                                  )}
                                >
                                  {r.bookingRef}
                                </a>
                              </div>
                              <div className="text-[10px] text-slate-400 pl-3.5 flex items-center gap-1.5">
                                {r.countryLabel}
                                {r.cancelled && (
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-[9px] font-bold uppercase tracking-wide"
                                    title="This booking has been cancelled. Nothing on the row is outstanding and it is excluded from every count on this board."
                                  >
                                    <XCircle className="w-2.5 h-2.5" /> Cancelled
                                  </span>
                                )}
                                {r.cancelPending && (
                                  <span
                                    className={cn(
                                      'inline-flex items-center gap-0.5 px-1.5 py-px rounded-full border text-[9px] font-bold uppercase tracking-wide',
                                      waitTone(r.cancellation?.waitingDays ?? null).chip,
                                    )}
                                    title={
                                      'A cancellation has been requested on this booking and the accounts team has not decided. '
                                      + `${waitLabel(r.cancellation?.waitingDays ?? null)}. `
                                      + (r.cancellation?.reason ? `Reason: ${r.cancellation.reason}` : 'No reason recorded.')
                                    }
                                  >
                                    <Ban className="w-2.5 h-2.5" /> Cancel Pending
                                    {r.cancellation?.waitingDays ? ` · ${r.cancellation.waitingDays}d` : ''}
                                  </span>
                                )}
                                {r.hotelOnly && (
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-bold uppercase tracking-wide"
                                    title="Hotel Only booking — accommodation only. No agenda, drivers, tickets, flights, client reconfirmation or QC."
                                  >
                                    <Hotel className="w-2.5 h-2.5" /> Hotel Only
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-slate-700 max-w-[180px] truncate" title={r.leadPassenger ?? ''}>
                              {r.leadPassenger || '—'}
                              <div className="text-[10px] text-slate-400 truncate">{r.agent || '—'}</div>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span className="font-semibold text-slate-700">{r.dayNo}</span>
                              <span className="text-slate-400">/{r.totalDays}</span>
                            </td>
                            <td className="px-3 py-2.5 text-center font-semibold text-slate-700">{r.pax}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {r.isArrival && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
                                  <PlaneLanding className="w-3 h-3" /> Arrives
                                </span>
                              )}
                              {r.isDeparture && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-[11px] font-semibold ml-1">
                                  <PlaneTakeoff className="w-3 h-3" /> Departs
                                </span>
                              )}
                              {!r.isArrival && !r.isDeparture && (
                                <span className="text-slate-400">{r.hotelOnly ? 'In hotel' : 'On tour'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <StatePill
                                state={reconfirmState(r)}
                                text={reconfirmText(r)}
                                title={reconfirmDetail(r)}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <StatePill
                                state={callState(r)}
                                text={callText(r)}
                                title={callDetail(r)}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <StatePill state={r.driver.state} text={r.driver.short} title={r.driver.detail} />
                            </td>
                            <td className="px-3 py-2.5">
                              <StatePill state={r.tickets.state} text={r.tickets.short} title={r.tickets.detail} />
                            </td>
                            <td className="px-3 py-2.5">
                              <StatePill
                                state={qcTick(r, 1)}
                                text={qcTick(r, 1) === 'DONE' ? 'Pass' : 'Pending'}
                                title={r.qc.detail}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <StatePill
                                state={qcTick(r, 2)}
                                text={qcTick(r, 2) === 'DONE' ? 'Pass' : 'Pending'}
                                title={r.qc.detail}
                              />
                            </td>
                            <td className="px-3 py-2.5 text-slate-300">
                              <motion.span
                                animate={{ rotate: open ? 180 : 0 }}
                                transition={reduce ? { duration: 0 } : { duration: 0.2 }}
                                className="inline-block"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </motion.span>
                            </td>
                          </motion.tr>

                          <AnimatePresence initial={false}>
                            {open && (
                              <tr key={`${r.bookingRef}-detail`}>
                                <td colSpan={12} className="p-0">
                                  <motion.div
                                    initial={reduce ? undefined : { height: 0, opacity: 0 }}
                                    animate={reduce ? undefined : { height: 'auto', opacity: 1 }}
                                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                                    transition={reduce ? { duration: 0 } : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                                    className="overflow-hidden bg-slate-50 border-b border-slate-200"
                                  >
                                    <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-3 gap-5">
                                      <div className="space-y-2">
                                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Tour</h4>
                                        <div className="text-xs text-slate-600 space-y-1">
                                          <div className="flex items-center gap-1.5">
                                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                                            {r.destination || r.countryLabel}
                                          </div>
                                          <div>
                                            {formatDate(r.arrivalDate)} → {formatDate(r.departureDate)}
                                            <span className="text-slate-400"> · {r.totalDays} days</span>
                                          </div>
                                          <div>
                                            {r.paxAdults} adult{r.paxAdults === 1 ? '' : 's'}
                                            {r.paxChildren > 0 && `, ${r.paxChildren} child`}
                                            {r.paxInfants > 0 && `, ${r.paxInfants} infant`}
                                          </div>
                                          <div className="text-slate-400">Status: {r.statusLabel}</div>
                                          {r.fileHandler && <div className="text-slate-400">Handler: {r.fileHandler}</div>}
                                        </div>
                                      </div>

                                      <div className="space-y-2">
                                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Reconfirmation</h4>
                                        <div className="text-xs text-slate-600 space-y-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className={cn('w-2 h-2 rounded-full', r.clientConfirmed ? 'bg-emerald-500' : 'bg-rose-500')} />
                                            Client confirm — {r.clientConfirmed ? 'done' : 'outstanding'}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className={cn('w-2 h-2 rounded-full', STATE_STYLE[callState(r)].dot)} />
                                            WhatsApp call request — {APPROVAL_LABEL[r.call.approval].toLowerCase()}
                                          </div>
                                          <div className="pl-4 text-[11px] text-slate-500">{callDetail(r)}</div>
                                          <div className="flex items-center gap-2">
                                            <span className={cn('w-2 h-2 rounded-full', r.preTourCall ? 'bg-emerald-500' : 'bg-rose-500')} />
                                            Pre-tour call — {r.preTourCall ? `logged ${formatDate(r.preTourCall.at)}` : 'not logged'}
                                          </div>
                                          {r.preTourCall && (
                                            <div className="pl-4 text-[11px] text-slate-500 space-y-0.5">
                                              {r.preTourCall.outcome && <div>Outcome: {r.preTourCall.outcome}</div>}
                                              {r.preTourCall.sentiment && <div>Sentiment: {r.preTourCall.sentiment}</div>}
                                              <div className="flex flex-wrap gap-x-3">
                                                {([
                                                  ['Dates', r.preTourCall.datesOk],
                                                  ['Flight', r.preTourCall.flightOk],
                                                  ['Pax', r.preTourCall.paxOk],
                                                  ['Contact', r.preTourCall.contactOk],
                                                ] as [string, string | null][])
                                                  .filter(([, v]) => v)
                                                  .map(([k, v]) => <span key={k}>{k}: {v}</span>)}
                                              </div>
                                              {r.preTourCall.requestedChange && (
                                                <div className="text-amber-700">Change asked: {r.preTourCall.requestedChange}</div>
                                              )}
                                              {r.preTourCall.summary && (
                                                <div className="text-slate-500 italic line-clamp-3">{r.preTourCall.summary}</div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      <div className="space-y-2">
                                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Checklist</h4>
                                        <div className="text-xs text-slate-600 space-y-1.5">
                                          <div><span className="font-semibold text-slate-700">Drivers:</span> {r.driver.detail}</div>
                                          <div><span className="font-semibold text-slate-700">Tickets:</span> {r.tickets.detail}</div>
                                          <div><span className="font-semibold text-slate-700">QC:</span> {r.qc.detail}</div>
                                          <div className={cn('font-semibold', r.ready ? 'text-emerald-600' : 'text-rose-600')}>
                                            {r.ready ? 'Nothing outstanding' : `Outstanding: ${r.outstanding.join(', ')}`}
                                          </div>
                                        </div>
                                      </div>

                                      {/* The full request, for the row somebody
                                          opened *because* of the badge. */}
                                      {r.cancellation && (r.cancelPending || r.cancelled) && (
                                        <div className={cn(
                                          'lg:col-span-3 rounded-xl border p-3',
                                          r.cancelPending ? waitTone(r.cancellation.waitingDays).ring : 'border-slate-200',
                                          r.cancelPending ? 'bg-orange-50/60' : 'bg-white',
                                        )}>
                                          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                                            <Ban className="w-3 h-3" />
                                            {r.cancelPending ? 'Cancellation — awaiting accounts approval' : 'Cancellation'}
                                          </h4>
                                          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-slate-600 sm:grid-cols-4">
                                            <div><span className="text-slate-400">Requested by:</span> {r.cancellation.requestedBy || '—'}</div>
                                            <div>
                                              <span className="text-slate-400">Requested on:</span>{' '}
                                              {r.cancellation.requestedAt ? formatDate(r.cancellation.requestedAt.slice(0, 10)) : '—'}
                                            </div>
                                            <div>
                                              <span className="text-slate-400">Waiting:</span>{' '}
                                              <span className={cn('font-semibold', waitTone(r.cancellation.waitingDays).text)}>
                                                {waitLabel(r.cancellation.waitingDays)}
                                              </span>
                                            </div>
                                            <div><span className="text-slate-400">Held at:</span> {r.cancellation.heldAtLabel || '—'}</div>
                                            <div>
                                              <span className="text-slate-400">Cancellation fee:</span>{' '}
                                              {r.cancellation.feeTotal != null
                                                ? formatCurrency(r.cancellation.feeTotal, r.cancellation.currency ?? 'USD')
                                                : '—'}
                                            </div>
                                            {r.cancellation.decidedAt && (
                                              <div>
                                                <span className="text-slate-400">Decided on:</span>{' '}
                                                {formatDate(r.cancellation.decidedAt.slice(0, 10))}
                                              </div>
                                            )}
                                          </div>
                                          <p className="mt-2 whitespace-pre-wrap text-[11px] text-slate-700">
                                            <span className="text-slate-400">Reason: </span>
                                            {r.cancellation.reason || 'No reason recorded.'}
                                          </p>
                                          {r.cancelPending && (
                                            <p className="mt-2 text-[10px] font-semibold text-orange-800">
                                              Every check above is still being chased on this file. Approve or reject the
                                              request in the Apple Accounts system before more cost is committed.
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                </td>
                              </tr>
                            )}
                          </AnimatePresence>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>

          {!loading && visible.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
              <span>
                Showing {visible.length} tour{visible.length === 1 ? '' : 's'}
                {onlyOutstanding && ' with something outstanding'}
              </span>
              <span className="flex flex-wrap gap-x-3">
                {board?.summary.byCountry.map(c => (
                  <span key={c.country}>
                    {c.label} <span className="font-semibold text-slate-700">{c.bookings}</span>
                  </span>
                ))}
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* ── Drill-down ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {focus && (
          <OpsDrilldown
            key={focus}
            focus={focus}
            anchorDate={from}
            anchorEnd={to}
            countryFilter={countryFilter}
            // Reuse the loaded window only when the board is unfiltered; otherwise
            // the modal would open showing a search the user did not type in it.
            initialBoard={search.trim() ? null : board}
            onClose={() => setFocus(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
