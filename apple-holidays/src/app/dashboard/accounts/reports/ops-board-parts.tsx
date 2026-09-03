'use client'

/**
 * Presentation pieces for the operations day board.
 *
 * Kept out of `page.tsx` so the page reads as data-flow and these read as
 * pixels. Everything here is pure: props in, motion out — no fetching, no
 * state that outlives a hover.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Minus, AlertTriangle, Clock, Car, PhoneCall, Ticket, ShieldCheck, Users, PlaneLanding, PlaneTakeoff, MessageCircle } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import type { ReadinessState } from '@/lib/booking-readiness'
import type { OpsDayRow } from '@/lib/reports/ops-day-data'
import {
  APPROVAL_LABEL, FACET_GROUPS, RECONFIRM_FACETS,
  type FacetGroup, type ReconfirmFacet,
} from '@/lib/reports/reconfirm-filters'
import { HOTEL_ONLY_LABEL } from '@/lib/hotel-only'
import { RECONFIRM_DUE_DAYS, delaySummary } from '@/lib/reconfirm-delay-shared'

// ─── Shared vocabulary ────────────────────────────────────────────────────────

/**
 * One colour per readiness state, used by every pill, ring and legend on the
 * page so a green ring and a green pill always mean the same thing.
 */
export const STATE_STYLE: Record<ReadinessState, {
  label: string
  chip: string
  dot: string
  ring: string
  soft: string
}> = {
  DONE:    { label: 'Done',    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', ring: '#10b981', soft: 'bg-emerald-500/10' },
  PARTIAL: { label: 'Partial', chip: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'bg-amber-500',   ring: '#f59e0b', soft: 'bg-amber-500/10' },
  PENDING: { label: 'Pending', chip: 'bg-rose-50 text-rose-700 border-rose-200',          dot: 'bg-rose-500',    ring: '#f43f5e', soft: 'bg-rose-500/10' },
  NA:      { label: 'N/A',     chip: 'bg-slate-50 text-slate-500 border-slate-200',       dot: 'bg-slate-300',   ring: '#cbd5e1', soft: 'bg-slate-500/10' },
}

const STATE_ICON: Record<ReadinessState, typeof Check> = {
  DONE: Check,
  PARTIAL: Clock,
  PENDING: AlertTriangle,
  NA: Minus,
}

// ─── Count-up number ──────────────────────────────────────────────────────────

/**
 * Ticks a number up to its new value over ~600ms.
 *
 * Written against `requestAnimationFrame` rather than a spring so the value is
 * always an integer on screen — a head-count that flickers through 6.4 people
 * reads as a bug. Honours `prefers-reduced-motion` by snapping.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)

  useEffect(() => {
    if (reduce) { setShown(value); fromRef.current = value; return }
    const from = fromRef.current
    if (from === value) return
    const start = performance.now()
    const duration = 600
    let raf = 0

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // easeOutCubic — fast off the mark, settles gently on the final figure.
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(from + (value - from) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, reduce])

  return <span className={className}>{shown}</span>
}

// ─── Progress ring ────────────────────────────────────────────────────────────

/**
 * A circular gauge for "how much of this check is clear".
 *
 * The arc is drawn with `strokeDasharray` and animated by framer-motion, which
 * keeps it smooth without a chart library. `size` is the outer diameter in px.
 */
export function ProgressRing({
  pct,
  color,
  size = 72,
  stroke = 7,
  children,
}: {
  pct: number
  color: string
  size?: number
  stroke?: number
  children?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="#e2e8f0" strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          transition={reduce ? { duration: 0 } : { duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  )
}

// ─── Status pill ──────────────────────────────────────────────────────────────

/**
 * The table cell for a single check — a coloured pill carrying the short text
 * ("4/4", "QC1 pass") and the full sentence as a tooltip.
 */
export function StatePill({
  state,
  text,
  title,
  className,
}: {
  state: ReadinessState
  text: string
  title?: string
  className?: string
}) {
  const style = STATE_STYLE[state]
  const Icon = STATE_ICON[state]
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap',
        style.chip,
        className,
      )}
    >
      <Icon className="w-3 h-3 flex-shrink-0" strokeWidth={3} />
      {text}
    </span>
  )
}

// ─── Segmented bar ────────────────────────────────────────────────────────────

/**
 * A one-line stacked bar showing how a check splits across the day's tours.
 * Segments animate their width, so switching dates reads as the bar rebalancing
 * rather than a hard cut.
 */
export function SegmentBar({
  segments,
  total,
}: {
  /**
   * `label` overrides the hover text for one band. The readiness gauges use it
   * to call the amber band "Done", because there a partially-covered file is
   * counted as handled — while the row chips and drill-down, which read the same
   * `STATE_STYLE`, must keep saying "Partial".
   */
  segments: { state: ReadinessState; value: number; label?: string }[]
  total: number
}) {
  const reduce = useReducedMotion()
  return (
    <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-slate-100">
      {segments.filter(s => s.value > 0).map(s => (
        <motion.div
          key={s.state}
          className={STATE_STYLE[s.state].dot}
          initial={{ width: 0 }}
          animate={{ width: `${total > 0 ? (s.value / total) * 100 : 0}%` }}
          transition={reduce ? { duration: 0 } : { duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          title={`${s.label ?? STATE_STYLE[s.state].label}: ${s.value}`}
        />
      ))}
    </div>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

/**
 * The seven things the board can be drilled into: the four readiness checks and
 * the three movement views. One union, because the modal, the tiles and the
 * gauges all address the same set and a mismatch between them would be a silent
 * routing bug.
 */
export type FocusKey =
  | 'reconfirm' | 'calls' | 'driver' | 'tickets' | 'qc'
  | 'onground' | 'arrivals' | 'departures'

export const FOCUS_META: Record<FocusKey, {
  label: string
  hint: string
  icon: typeof Check
  /** Movement views describe *who* is on the board; checks describe *readiness*. */
  kind: 'check' | 'movement'
}> = {
  reconfirm:  { label: 'Reconfirmation',    hint: 'Client confirm or pre-tour call',        icon: PhoneCall,    kind: 'check' },
  calls:      { label: 'Call Requests',     hint: 'WhatsApp permission to call the guest',  icon: MessageCircle, kind: 'check' },
  driver:     { label: 'Driver Allocation', hint: 'Every transfer has a driver or vendor',  icon: Car,          kind: 'check' },
  tickets:    { label: 'Tickets Issued',    hint: 'Every active ticket purchased or paid',  icon: Ticket,       kind: 'check' },
  qc:         { label: 'QC1 / QC2',         hint: 'Both quality rounds signed off',         icon: ShieldCheck,  kind: 'check' },
  onground:   { label: 'On Ground',         hint: 'Every tour running in the window',       icon: Users,        kind: 'movement' },
  arrivals:   { label: 'Arrivals',          hint: 'Guests landing in the window',           icon: PlaneLanding, kind: 'movement' },
  departures: { label: 'Departures',        hint: 'Guests leaving in the window',           icon: PlaneTakeoff, kind: 'movement' },
}

// ─── Row-level status derivation ──────────────────────────────────────────────
// Shared by the board table and the drill-down so a booking can never show as
// amber on one and red on the other.

/**
 * Reconfirmation is two independent signals and the board treats either one as
 * enough — a guest who has confirmed in writing does not also need a call, and a
 * completed pre-tour call reconfirms a booking whose status has not caught up.
 * Both signals in is the only fully-green state.
 */
export function reconfirmState(r: OpsDayRow): ReadinessState {
  // Hotel Only has no tour to run the guest through, so neither signal is ever
  // coming. N/A, not pending — the desk must not be sent chasing it.
  if (r.hotelOnly) return 'NA'
  if (r.clientConfirmed && r.preTourCall) return 'DONE'
  if (r.clientConfirmed || r.preTourCall) return 'PARTIAL'
  return 'PENDING'
}

export function reconfirmText(r: OpsDayRow): string {
  if (r.hotelOnly) return HOTEL_ONLY_LABEL
  if (r.clientConfirmed && r.preTourCall) return 'Confirmed + called'
  if (r.clientConfirmed) return 'Client confirmed'
  if (r.preTourCall) return 'Pre-tour call'
  // A missed deadline says how badly, and whether the desk owes an answer for
  // it — "Not reconfirmed" alone is the cell that made this feature necessary.
  if (r.reconfirmBreached) {
    const late = `${Math.abs(r.reconfirmStanding.daysToDue)}d late`
    return r.reconfirmDelay ? `${late} · ${r.reconfirmDelay.reasonLabel}` : `${late} · no reason`
  }
  return 'Not reconfirmed'
}

export function reconfirmDetail(r: OpsDayRow): string {
  if (r.hotelOnly) {
    return 'Hotel Only booking — no tour to reconfirm with the guest. '
      + 'The hotel itself is still reconfirmed on the Pre-checking queue.'
  }
  return [
    r.clientConfirmed ? 'Client has confirmed the booking' : 'Client confirmation outstanding',
    r.preTourCall
      ? `Pre-tour call logged ${formatDate(r.preTourCall.at)}${r.preTourCall.outcome ? ` — ${r.preTourCall.outcome}` : ''}`
      : 'No pre-tour call logged',
    // The D-10 line is appended rather than replacing the two signals above: the
    // operator needs to see both what is missing and what is being done about it.
    ...(r.reconfirmBreached ? [delaySummary(r.reconfirmStanding, r.reconfirmDelay)] : []),
  ].join(' · ')
}

/**
 * The WhatsApp call request, graded on the same four-state scale as every other
 * check so one legend covers the whole board.
 *
 * `unknown` grades as N/A rather than pending: the ledger being unreadable is
 * our problem, not the customer's, and colouring it red would send ops chasing
 * guests who may well have accepted already.
 */
export function callState(r: OpsDayRow): ReadinessState {
  // No call is ever placed for a room-only file, so permission is moot.
  if (r.hotelOnly) return 'NA'
  switch (r.call.approval) {
    case 'approved':      return 'DONE'
    case 'pending':       return 'PARTIAL'
    case 'not_requested': return 'PENDING'
    default:              return 'NA'
  }
}

export function callText(r: OpsDayRow): string {
  if (r.hotelOnly) return HOTEL_ONLY_LABEL
  return APPROVAL_LABEL[r.call.approval]
}

export function callDetail(r: OpsDayRow): string {
  if (r.hotelOnly) return 'Hotel Only booking — no pre-tour call is placed for these files'
  const c = r.call
  const parts: string[] = []

  if (c.approval === 'approved') {
    parts.push(c.approvedAt
      ? `Customer accepted the WhatsApp call request on ${formatDate(c.approvedAt.slice(0, 10))}`
      : 'Customer has accepted automated WhatsApp calls')
  } else if (c.approval === 'pending') {
    parts.push(c.approvalRequestedAt
      ? `Request sent ${formatDate(c.approvalRequestedAt.slice(0, 10))} — not accepted yet`
      : 'Request sent — not accepted yet')
  } else if (c.approval === 'not_requested') {
    parts.push(c.registered
      ? 'No WhatsApp call request has been sent — the bot cannot call this guest'
      : 'Not registered for AI calls, and no WhatsApp request sent')
  } else {
    parts.push('Approval ledger unavailable — permission unknown')
  }

  if (c.completed) parts.push('reconfirmation call completed')
  else if (c.scheduledAt) {
    parts.push(`pre-tour call ${c.scheduleStatus ?? 'scheduled'} for ${formatDate(c.scheduledAt.slice(0, 10))}`
      + (c.attempts > 0 ? ` after ${c.attempts} attempt${c.attempts === 1 ? '' : 's'}` : ''))
  } else if (c.registered) parts.push('no pre-tour call scheduled')

  return parts.join(' · ')
}

/** QC1 and QC2 are shown as two separate ticks; both come off the one stage. */
export function qcTick(r: OpsDayRow, round: 1 | 2): ReadinessState {
  if (r.qc.stage === 'QC2') return 'DONE'
  if (r.qc.stage === 'QC1') return round === 1 ? 'DONE' : 'PENDING'
  return 'PENDING'
}

/** The state a row contributes to a given focus. Movement views grade on overall readiness. */
export function stateForFocus(focus: FocusKey, r: OpsDayRow): ReadinessState {
  switch (focus) {
    case 'reconfirm': return reconfirmState(r)
    case 'calls': return callState(r)
    case 'driver': return r.driver.state
    case 'tickets': return r.tickets.state
    case 'qc': return r.qc.state
    default: return r.ready ? 'DONE' : 'PENDING'
  }
}

/** Short cell text for a focus. */
export function textForFocus(focus: FocusKey, r: OpsDayRow): string {
  switch (focus) {
    case 'reconfirm': return reconfirmText(r)
    case 'calls': return callText(r)
    case 'driver': return r.driver.short
    case 'tickets': return r.tickets.short
    case 'qc': return r.qc.short
    default: return r.ready ? 'Ready' : 'Outstanding'
  }
}

/** Sentence-length explanation for a focus. */
export function detailForFocus(focus: FocusKey, r: OpsDayRow): string {
  switch (focus) {
    case 'reconfirm': return reconfirmDetail(r)
    case 'calls': return callDetail(r)
    case 'driver': return r.driver.detail
    case 'tickets': return r.tickets.detail
    case 'qc': return r.qc.detail
    default: return r.ready ? 'Nothing outstanding' : `Outstanding: ${r.outstanding.join(', ')}`
  }
}

/** Does this row belong in the focus's row set at all? */
export function inFocus(focus: FocusKey, r: OpsDayRow): boolean {
  if (focus === 'arrivals') return r.isArrival
  if (focus === 'departures') return r.isDeparture
  return true
}

// ─── Reconfirmation facet chips ───────────────────────────────────────────────

const GROUP_LABEL: Record<FacetGroup, string> = {
  scope: 'Booking type',
  client: 'Client confirm',
  call: 'Reconfirm call',
  approval: 'WhatsApp call request',
  delay: `D-${RECONFIRM_DUE_DAYS} deadline`,
}

/**
 * The reconfirmation filter bar.
 *
 * Five chips in three groups, each carrying the count it would leave behind, so
 * the size of the job is visible before anyone clicks. Chips in one group OR
 * together, groups AND — stated in the footnote rather than left to be guessed,
 * because "Client not confirmed + Call request pending" is the combination ops
 * came here for and it has to be obviously reachable.
 *
 * A count of zero still renders: an empty "Reconfirmation pending" chip is the
 * good news, and hiding it would make the day look unmeasured instead of clear.
 */
export function ReconfirmFacetBar({
  selected,
  counts,
  total,
  onToggle,
  onClear,
  approvalUnavailable,
}: {
  selected: Set<ReconfirmFacet>
  counts: Record<ReconfirmFacet, number>
  total: number
  onToggle: (key: ReconfirmFacet) => void
  onClear: () => void
  /** True when the approval ledger could not be read on this environment. */
  approvalUnavailable?: boolean
}) {
  const reduce = useReducedMotion()

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          <PhoneCall className="w-3.5 h-3.5" />
          Reconfirmation
        </span>

        {FACET_GROUPS.map((group, gi) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            {gi > 0 && <span className="hidden sm:block w-px h-5 bg-slate-200 mr-1.5" />}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300 mr-0.5">
              {GROUP_LABEL[group]}
            </span>
            {RECONFIRM_FACETS.filter(f => f.group === group).map(f => {
              const on = selected.has(f.key)
              const count = counts[f.key] ?? 0
              const muted = group === 'approval' && approvalUnavailable
              return (
                <motion.button
                  key={f.key}
                  onClick={() => onToggle(f.key)}
                  title={muted ? `${f.hint} — approval data unavailable here` : f.hint}
                  aria-pressed={on}
                  whileTap={reduce ? undefined : { scale: 0.96 }}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors',
                    on ? f.chip : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
                    muted && !on && 'opacity-50',
                  )}
                >
                  <span className={cn('w-2 h-2 rounded-full', on ? f.dot : 'bg-slate-300')} />
                  {f.label}
                  <span className={cn('font-bold tabular-nums', on ? 'opacity-70' : 'text-slate-400')}>
                    {count}
                  </span>
                </motion.button>
              )
            })}
          </div>
        ))}

        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="ml-auto px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          >
            Clear reconfirmation
          </button>
        )}
      </div>

      <p className="mt-2 text-[10px] text-slate-400">
        {selected.size === 0
          ? `Counts are out of ${total} tour${total === 1 ? '' : 's'} in view. Pick chips to narrow the list.`
          : 'Chips in the same group match either; different groups must all match.'}
      </p>
    </div>
  )
}

export function StateLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
      {(['DONE', 'PARTIAL', 'PENDING', 'NA'] as ReadinessState[]).map(s => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', STATE_STYLE[s].dot)} />
          {STATE_STYLE[s].label}
        </span>
      ))}
    </div>
  )
}
