'use client'

/**
 * Shared visual language for Pre-checking.
 *
 * The booking-detail panel and the standalone queue page render the same
 * concepts — how urgent a stay is, what the hotel said, how reachable the
 * property is, how sure we are of a name match. Those live here once so the
 * two surfaces can never drift into telling the operator different stories.
 */

import { cn } from '@/lib/utils'
import {
  AlertTriangle, CheckCircle2, CircleDashed, Clock, HelpCircle, MinusCircle,
  PhoneOff, ShieldQuestion, XCircle, type LucideIcon,
} from 'lucide-react'

// ─── Status ──────────────────────────────────────────────────────────────────

export const STATUS_META: Record<string, { label: string; icon: LucideIcon; chip: string; ring: string; dot: string }> = {
  PENDING:      { label: 'Pending',      icon: CircleDashed,   chip: 'bg-slate-100 text-slate-600 border-slate-200',     ring: 'ring-slate-200',   dot: 'bg-slate-400' },
  IN_PROGRESS:  { label: 'In progress',  icon: Clock,          chip: 'bg-sky-50 text-sky-700 border-sky-200',            ring: 'ring-sky-200',     dot: 'bg-sky-500' },
  CONFIRMED:    { label: 'Confirmed',    icon: CheckCircle2,   chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', ring: 'ring-emerald-200', dot: 'bg-emerald-500' },
  DISCREPANCY:  { label: 'Discrepancy',  icon: ShieldQuestion, chip: 'bg-amber-50 text-amber-700 border-amber-200',      ring: 'ring-amber-200',   dot: 'bg-amber-500' },
  ISSUE:        { label: 'Issue',        icon: AlertTriangle,  chip: 'bg-rose-50 text-rose-700 border-rose-200',         ring: 'ring-rose-200',    dot: 'bg-rose-500' },
  CANCELLED:    { label: 'Cancelled',    icon: XCircle,        chip: 'bg-slate-100 text-slate-500 border-slate-200',     ring: 'ring-slate-200',   dot: 'bg-slate-400' },
  NOT_REQUIRED: { label: 'Not required', icon: MinusCircle,    chip: 'bg-violet-50 text-violet-600 border-violet-200',   ring: 'ring-violet-200',  dot: 'bg-violet-400' },
}

export const STATUS_ORDER = [
  'PENDING', 'IN_PROGRESS', 'CONFIRMED', 'DISCREPANCY', 'ISSUE', 'CANCELLED', 'NOT_REQUIRED',
] as const

export function StatusPill({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const m = STATUS_META[status] ?? { label: status, icon: HelpCircle, chip: 'bg-slate-100 text-slate-600 border-slate-200', ring: '', dot: 'bg-slate-400' }
  const Icon = m.icon
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap',
      m.chip,
      size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
    )}>
      <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {m.label}
    </span>
  )
}

// ─── Urgency ─────────────────────────────────────────────────────────────────

export const URGENCY_META: Record<string, { label: string; chip: string; bar: string; glow: string }> = {
  OVERDUE:   { label: 'Overdue',   chip: 'bg-rose-600 text-white',        bar: 'bg-rose-500',    glow: 'shadow-[0_0_0_3px_rgba(244,63,94,0.12)]' },
  DUE_TODAY: { label: 'Due today', chip: 'bg-amber-500 text-white',       bar: 'bg-amber-500',   glow: 'shadow-[0_0_0_3px_rgba(245,158,11,0.14)]' },
  DUE_SOON:  { label: 'Due soon',  chip: 'bg-yellow-100 text-yellow-800', bar: 'bg-yellow-400',  glow: '' },
  UPCOMING:  { label: 'Upcoming',  chip: 'bg-slate-100 text-slate-600',   bar: 'bg-slate-300',   glow: '' },
  SETTLED:   { label: 'Settled',   chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-400', glow: '' },
  PAST:      { label: 'Past',      chip: 'bg-slate-100 text-slate-400',   bar: 'bg-slate-200',   glow: '' },
}

/**
 * Countdown ring for one stay.
 *
 * The ring fills as the stay travels from "booked" to "check-in", and the
 * number in the middle is days-to-due — negative and red once D-10 has passed.
 * One glance down a column tells you what is on fire without reading a date.
 */
export function DueRing({
  daysToDue, daysToCheckIn, urgency, size = 46,
}: { daysToDue: number; daysToCheckIn: number; urgency: string; size?: number }) {
  const r = size / 2 - 4
  const circumference = 2 * Math.PI * r

  // Progress across the 10-day reconfirmation window: 0 at D-10, 1 at check-in.
  const raw = (10 - Math.max(0, Math.min(10, daysToCheckIn))) / 10
  const progress = daysToCheckIn < 0 ? 1 : Math.max(0.04, raw)

  const stroke =
    urgency === 'OVERDUE'   ? '#e11d48' :
    urgency === 'DUE_TODAY' ? '#f59e0b' :
    urgency === 'DUE_SOON'  ? '#eab308' :
    urgency === 'SETTLED'   ? '#10b981' : '#cbd5e1'

  const label = urgency === 'SETTLED' ? '✓' : daysToDue === 0 ? 'now' : `${daysToDue > 0 ? '' : ''}${daysToDue}`

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }} title={
      urgency === 'SETTLED' ? 'Settled' :
      daysToDue < 0 ? `${Math.abs(daysToDue)} day(s) past the D-10 deadline` :
      daysToDue === 0 ? 'D-10 deadline is today' : `${daysToDue} day(s) until the D-10 deadline`
    }>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth="3.5" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={stroke} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={cn(
          'font-bold tabular-nums',
          size > 40 ? 'text-[13px]' : 'text-[11px]',
          urgency === 'OVERDUE' ? 'text-rose-600' :
          urgency === 'DUE_TODAY' ? 'text-amber-600' :
          urgency === 'SETTLED' ? 'text-emerald-600' : 'text-slate-600',
        )}>{label}</span>
        {size > 40 && urgency !== 'SETTLED' && (
          <span className="text-[7px] font-semibold uppercase tracking-wider text-slate-400">days</span>
        )}
      </div>
    </div>
  )
}

export function UrgencyChip({ urgency, className }: { urgency: string; className?: string }) {
  const m = URGENCY_META[urgency] ?? URGENCY_META.UPCOMING
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', m.chip, className)}>
      {m.label}
    </span>
  )
}

// ─── Contact health ──────────────────────────────────────────────────────────

/**
 * Five-segment meter for how reachable a hotel is.
 *
 * Deliberately not a percentage — staff do not need "65%", they need to know
 * at a glance whether they can actually get hold of this property today.
 */
export function HealthMeter({
  score, label, missing, compact,
}: { score: number; label: string; missing?: string[]; compact?: boolean }) {
  const filled = Math.round((score / 100) * 5)
  const colour =
    score === 0 ? 'bg-rose-400' :
    score < 35  ? 'bg-orange-400' :
    score < 60  ? 'bg-amber-400' :
    score < 85  ? 'bg-lime-500' : 'bg-emerald-500'

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={missing && missing.length > 0 ? `Missing: ${missing.join(', ')}` : 'All contact details on file'}
    >
      <span className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={cn('h-2.5 w-1 rounded-full', i < filled ? colour : 'bg-slate-200')} />
        ))}
      </span>
      {!compact && (
        <span className={cn('text-[10px] font-semibold', score === 0 ? 'text-rose-500' : 'text-slate-500')}>
          {label}
        </span>
      )}
    </span>
  )
}

export function NoContactBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
      <PhoneOff className="w-3 h-3" /> No contact
    </span>
  )
}

// ─── Match confidence ────────────────────────────────────────────────────────

/**
 * Confidence bar for a fuzzy hotel-name match, with the reasons that produced
 * it. Showing *why* a match scored 87 is what makes staff willing to accept it
 * — an unexplained number just gets ignored.
 */
export function ConfidenceBar({ confidence, signals }: { confidence: number; signals?: string[] }) {
  const colour =
    confidence >= 93 ? 'bg-emerald-500' :
    confidence >= 75 ? 'bg-lime-500' :
    confidence >= 60 ? 'bg-amber-400' : 'bg-slate-300'

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
        <div className={cn('h-full rounded-full transition-all', colour)} style={{ width: `${confidence}%` }} />
      </div>
      <span className="text-[10px] font-bold tabular-nums text-slate-500 flex-shrink-0">{confidence}%</span>
      {signals && signals.length > 0 && (
        <span className="text-[10px] text-slate-400 truncate">{signals.join(' · ')}</span>
      )}
    </div>
  )
}

// ─── Small helpers ───────────────────────────────────────────────────────────

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function fmtDayShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'never'
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Labelled read-only field used across the detail views. */
export function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={cn('text-xs text-slate-800 truncate', mono && 'font-mono')}>{value ?? '—'}</div>
    </div>
  )
}
