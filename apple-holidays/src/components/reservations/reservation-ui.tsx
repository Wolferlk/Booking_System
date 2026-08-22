'use client'

/**
 * Shared presentation pieces for the Reservation Team screens.
 *
 * Kept in one file so the Deadline Board, the Request Inbox, the list and the
 * drawer cannot drift into three different colour languages for the same
 * status. The palette itself lives in `reservation-shared.ts`, next to the
 * arithmetic, so the server can label a row the same way the browser does.
 */

import { cn } from '@/lib/utils'
import {
  STATUS_LABELS, STATUS_STYLES, URGENCY_STYLES, MEAL_PLAN_LABELS,
  formatMoney, type ReservationStatusValue, type Urgency, type MealPlanValue,
  type Numeric,
} from '@/lib/reservation-shared'

export function StatusChip({ status, className }: { status: ReservationStatusValue; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
      STATUS_STYLES[status] ?? STATUS_STYLES.REQUESTED,
      className,
    )}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function UrgencyChip({ urgency, children }: { urgency: Urgency; children: React.ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
      URGENCY_STYLES[urgency],
    )}>
      {children}
    </span>
  )
}

export function MealPlanChip({ plan }: { plan: MealPlanValue }) {
  return (
    <span
      className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600"
      title={MEAL_PLAN_LABELS[plan] ?? plan}
    >
      {plan}
    </span>
  )
}

/** A labelled value. `mono` for references and numbers that want alignment. */
export function Field({
  label, children, mono, className,
}: { label: string; children: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn('truncate text-sm text-slate-800', mono && 'font-mono tabular-nums')}>
        {children ?? '—'}
      </div>
    </div>
  )
}

/**
 * Money against its budget.
 *
 * Over-budget is red, under is green, and an unknown budget renders as neither
 * — a variance against nothing is not zero, and must not look like it.
 */
export function MoneyVariance({
  amount, budget, currency = 'USD',
}: { amount: Numeric; budget: Numeric; currency?: string }) {
  const a = amount == null ? null : Number(amount)
  const b = budget == null ? null : Number(budget)
  if (a === null) return <span className="text-slate-400">—</span>

  if (b === null || Number.isNaN(b)) {
    return <span className="font-mono tabular-nums text-slate-800">{formatMoney(a, currency)}</span>
  }

  const diff = Math.round((a - b) * 100) / 100
  const pct = b === 0 ? null : Math.round((diff / b) * 1000) / 10
  const over = diff > 0

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-mono tabular-nums text-slate-800">{formatMoney(a, currency)}</span>
      {diff !== 0 && (
        <span className={cn('text-[11px] font-medium', over ? 'text-red-600' : 'text-emerald-600')}>
          {over ? '+' : ''}{diff}{pct !== null ? ` (${pct}%)` : ''}
        </span>
      )}
    </span>
  )
}

/** Empty-state block, used by every list on these screens. */
export function EmptyState({
  icon, title, hint,
}: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/** `2026-03-14` → `14 Mar 2026`. Dates are stored and compared in UTC. */
export function fmtDay(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function fmtDayShort(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

/** Relative day count, phrased the way the team speaks. */
export function relDays(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`
}
