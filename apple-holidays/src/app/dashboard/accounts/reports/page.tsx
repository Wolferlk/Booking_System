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
  PlaneLanding, PlaneTakeoff, Users, Car, PhoneCall, Ticket, ShieldCheck,
  ChevronDown, MapPin, CircleAlert, Sparkles, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { cn, formatDate } from '@/lib/utils'
import type { OpsDayBoard, OpsDayRow } from '@/lib/reports/ops-day-data'
import type { ReadinessState } from '@/lib/booking-readiness'
import {
  CountUp, ProgressRing, SegmentBar, StateLegend, StatePill, STATE_STYLE,
} from './ops-board-parts'

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

/**
 * Reconfirmation is two independent signals and the board treats either one as
 * enough — a guest who has confirmed in writing does not also need a call, and a
 * completed pre-tour call reconfirms a booking whose status has not caught up.
 */
function reconfirmState(r: OpsDayRow): ReadinessState {
  if (r.clientConfirmed && r.preTourCall) return 'DONE'
  if (r.clientConfirmed || r.preTourCall) return 'PARTIAL'
  return 'PENDING'
}

function reconfirmText(r: OpsDayRow): string {
  if (r.clientConfirmed && r.preTourCall) return 'Confirmed + called'
  if (r.clientConfirmed) return 'Client confirmed'
  if (r.preTourCall) return 'Pre-tour call'
  return 'Not reconfirmed'
}

function reconfirmDetail(r: OpsDayRow): string {
  const bits = [
    r.clientConfirmed ? 'Client has confirmed the booking' : 'Client confirmation outstanding',
    r.preTourCall
      ? `Pre-tour call logged ${formatDate(r.preTourCall.at)}${r.preTourCall.outcome ? ` — ${r.preTourCall.outcome}` : ''}`
      : 'No pre-tour call logged',
  ]
  return bits.join(' · ')
}

/** QC1 and QC2 are shown as two separate ticks; both come off the one stage. */
function qcTick(r: OpsDayRow, round: 1 | 2): ReadinessState {
  if (r.qc.stage === 'QC2') return 'DONE'
  if (r.qc.stage === 'QC1') return round === 1 ? 'DONE' : 'PENDING'
  return 'PENDING'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OperationsBoardPage() {
  const { countryFilter } = useCountryFilter()
  const reduce = useReducedMotion()

  const [date, setDate] = useState(todayLocal())
  const [search, setSearch] = useState('')
  const [board, setBoard] = useState<OpsDayBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [segment, setSegment] = useState<Segment>('ONGROUND')
  const [onlyOutstanding, setOnlyOutstanding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const params = new URLSearchParams({ date })
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
  }, [date, search, countryFilter])

  // Date and country reload immediately; the search box is debounced so typing a
  // booking ref does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { load() }, search ? 350 : 0)
    return () => clearTimeout(t)
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setExpanded(null) }, [segment, date])

  const visible = useMemo(() => {
    const bySegment = (board?.rows ?? []).filter(r =>
      segment === 'ARRIVALS' ? r.isArrival
        : segment === 'DEPARTURES' ? r.isDeparture
          : true)
    return onlyOutstanding ? bySegment.filter(r => !r.ready) : bySegment
  }, [board, segment, onlyOutstanding])

  // ── The four gauges ────────────────────────────────────────────────────────
  // Computed over the *visible* rows so the rings describe exactly the list
  // underneath them; switching to Arrivals re-scopes the whole board.
  const gauges = useMemo(() => {
    const tally = (pick: (r: OpsDayRow) => ReadinessState) => {
      const counts: Record<ReadinessState, number> = { DONE: 0, PARTIAL: 0, PENDING: 0, NA: 0 }
      for (const r of visible) counts[pick(r)] += 1
      // N/A rows are excluded from the denominator: a tour with no tickets to
      // buy should not drag the "tickets issued" gauge down.
      const scope = counts.DONE + counts.PARTIAL + counts.PENDING
      const pct = scope > 0 ? ((counts.DONE + counts.PARTIAL * 0.5) / scope) * 100 : 0
      const state: ReadinessState = scope === 0 ? 'NA'
        : counts.DONE === scope ? 'DONE'
          : counts.DONE + counts.PARTIAL > 0 ? 'PARTIAL' : 'PENDING'
      return { counts, scope, pct, state }
    }

    return [
      {
        key: 'reconfirm',
        label: 'Reconfirmation',
        hint: 'Client confirm or pre-tour call',
        icon: PhoneCall,
        ...tally(reconfirmState),
      },
      {
        key: 'driver',
        label: 'Driver Allocation',
        hint: 'Every transfer has a driver or vendor',
        icon: Car,
        ...tally(r => r.driver.state),
      },
      {
        key: 'tickets',
        label: 'Tickets Issued',
        hint: 'Every active ticket purchased or paid',
        icon: Ticket,
        ...tally(r => r.tickets.state),
      },
      {
        key: 'qc',
        label: 'QC1 / QC2',
        hint: 'Both quality rounds signed off',
        icon: ShieldCheck,
        ...tally(r => r.qc.state),
      },
    ]
  }, [visible])

  const readyCount = visible.filter(r => r.ready).length
  const readyPct = visible.length ? Math.round((readyCount / visible.length) * 100) : 0

  // A week rail centred two days back, so yesterday's loose ends stay one click away.
  const railDays = useMemo(
    () => Array.from({ length: 9 }, (_, i) => shift(date, i - 4)),
    [date],
  )
  const today = todayLocal()

  function exportCSV() {
    if (!visible.length) { toast.error('Nothing to export'); return }
    const headers = [
      'Booking Ref', 'Lead Passenger', 'Agent', 'File Handler', 'Country', 'Destination',
      'Status', 'Arrival', 'Departure', 'Day', 'Pax',
      'On Board Date', 'Client Confirmed', 'Pre-Tour Call', 'Call Outcome',
      'Driver Allocation', 'Tickets', 'QC Stage', 'QC1', 'QC2', 'Outstanding',
    ]
    const lines = visible.map(r => [
      r.bookingRef, r.leadPassenger ?? '', r.agent ?? '', r.fileHandler ?? '',
      r.countryLabel, r.destination ?? '', r.statusLabel,
      r.arrivalDate, r.departureDate, `${r.dayNo}/${r.totalDays}`, r.pax,
      r.isArrival ? 'Arriving' : r.isDeparture ? 'Departing' : 'On tour',
      r.clientConfirmed ? 'Yes' : 'No',
      r.preTourCall ? `Yes (${r.preTourCall.at})` : 'No',
      r.preTourCall?.outcome ?? '',
      r.driver.short, r.tickets.short, r.qc.short,
      qcTick(r, 1) === 'DONE' ? 'Pass' : 'Pending',
      qcTick(r, 2) === 'DONE' ? 'Pass' : 'Pending',
      r.outstanding.join('; ') || 'None',
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))

    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ops-board-${date}-${segment.toLowerCase()}.csv`
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

        {/* ── Date rail ───────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardBody className="p-3 sm:p-4">
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
          </CardBody>
        </Card>

        {/* ── Hero counts ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              key: 'ONGROUND' as Segment, label: 'On Ground', icon: Users,
              value: board?.summary.onGround ?? 0, pax: board?.summary.paxOnGround ?? 0,
              from: 'from-navy-600', to: 'to-navy-800',
            },
            {
              key: 'ARRIVALS' as Segment, label: 'Arrivals', icon: PlaneLanding,
              value: board?.summary.arrivals ?? 0, pax: board?.summary.paxArriving ?? 0,
              from: 'from-emerald-500', to: 'to-emerald-700',
            },
            {
              key: 'DEPARTURES' as Segment, label: 'Departures', icon: PlaneTakeoff,
              value: board?.summary.departures ?? 0, pax: board?.summary.paxDeparting ?? 0,
              from: 'from-sky-500', to: 'to-sky-700',
            },
          ].map((k, i) => (
            <motion.button
              key={k.key}
              onClick={() => setSegment(k.key)}
              {...fade}
              transition={reduce ? { duration: 0 } : { delay: i * 0.06, duration: 0.35 }}
              whileHover={reduce ? undefined : { y: -3 }}
              className={cn(
                'relative text-left rounded-2xl p-5 overflow-hidden bg-gradient-to-br text-white shadow-lg transition-shadow',
                k.from, k.to,
                segment === k.key ? 'ring-2 ring-offset-2 ring-slate-900' : 'hover:shadow-xl',
              )}
            >
              {/* Decorative wash — keeps the tiles from reading as flat blocks. */}
              <span className="absolute -right-6 -top-8 w-32 h-32 rounded-full bg-white/10" />
              <span className="absolute -right-12 top-6 w-32 h-32 rounded-full bg-white/5" />

              <div className="relative flex items-start justify-between">
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
                <k.icon className="w-8 h-8 text-white/50" />
              </div>
            </motion.button>
          ))}
        </div>

        {/* ── Readiness gauges ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {gauges.map((g, i) => (
            <motion.div
              key={g.key}
              {...fade}
              transition={reduce ? { duration: 0 } : { delay: 0.15 + i * 0.06, duration: 0.35 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-card p-4 hover:shadow-card-hover transition-shadow"
            >
              <div className="flex items-center gap-4">
                <ProgressRing pct={g.pct} color={STATE_STYLE[g.state].ring}>
                  <span className="text-sm font-extrabold text-slate-900 leading-none">
                    <CountUp value={g.counts.DONE} />
                    <span className="text-slate-400 font-semibold">/{g.scope}</span>
                  </span>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <g.icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-sm font-bold text-slate-900 truncate">{g.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{g.hint}</p>
                  <div className="mt-2 space-y-1.5">
                    <SegmentBar
                      total={visible.length}
                      segments={[
                        { state: 'DONE', value: g.counts.DONE },
                        { state: 'PARTIAL', value: g.counts.PARTIAL },
                        { state: 'PENDING', value: g.counts.PENDING },
                        { state: 'NA', value: g.counts.NA },
                      ]}
                    />
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                      {g.counts.PARTIAL > 0 && <span className="text-amber-600 font-semibold">{g.counts.PARTIAL} partial</span>}
                      {g.counts.PENDING > 0 && <span className="text-rose-600 font-semibold">{g.counts.PENDING} pending</span>}
                      {g.counts.NA > 0 && <span>{g.counts.NA} n/a</span>}
                      {g.counts.PARTIAL + g.counts.PENDING === 0 && g.scope > 0 && (
                        <span className="text-emerald-600 font-semibold">All clear</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
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
          <StateLegend />
        </motion.div>

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
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    className="form-input pl-8 py-1.5 text-xs w-52"
                    placeholder="Ref, agent, passenger…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
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
                    : 'No tours match this date and filter'}
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {[
                        'Booking', 'Lead Pax', 'Day', 'Pax', 'Movement',
                        'Reconfirm', 'Driver', 'Tickets', 'QC1', 'QC2', '',
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
                              open ? 'bg-slate-50' : 'hover:bg-slate-50',
                            )}
                          >
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                                  r.ready ? 'bg-emerald-500' : 'bg-rose-500',
                                )} />
                                <a
                                  href={`/dashboard/bookings/${r.bookingRef}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="font-mono font-bold text-brand-700 hover:underline"
                                >
                                  {r.bookingRef}
                                </a>
                              </div>
                              <div className="text-[10px] text-slate-400 pl-3.5">{r.countryLabel}</div>
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
                                <span className="text-slate-400">On tour</span>
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
                                <td colSpan={11} className="p-0">
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
    </div>
  )
}
