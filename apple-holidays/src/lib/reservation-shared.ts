/**
 * Reservation Team — pure shapes and arithmetic.
 *
 * Server-only concerns (Prisma, sessions) live in `reservations.ts` and
 * `reservations-write.ts`. Everything here is importable from the browser, so
 * the Deadline Board and the option comparison compute the same numbers the
 * API does rather than trusting whatever the server happened to send.
 *
 * Mirrors the split already used by `precheck-shared.ts` / `hotel-precheck.ts`.
 */

export type ReservationStatusValue =
  | 'REQUESTED' | 'QUOTING' | 'OPTION_HELD' | 'PENDING_HOTEL' | 'CONFIRMED'
  | 'AMEND_REQUESTED' | 'AMENDED' | 'CANCEL_REQUESTED' | 'CANCELLED'
  | 'NO_SHOW' | 'WAITLISTED' | 'REJECTED'

export type MealPlanValue = 'RO' | 'BB' | 'HB' | 'FB' | 'AI'

export const DAY_MS = 86_400_000

/** Deadline lanes on the board, in the order the team should work them. */
export type LaneKey =
  | 'optionReleasing'
  | 'awaitingHotel'
  | 'paymentDue'
  | 'proformaMissing'
  | 'creditNotesAgeing'

export type Urgency = 'overdue' | 'critical' | 'soon' | 'later' | 'done'

export const STATUS_LABELS: Record<ReservationStatusValue, string> = {
  REQUESTED:       'Requested',
  QUOTING:         'Quoting',
  OPTION_HELD:     'Option Held',
  PENDING_HOTEL:   'Awaiting Hotel',
  CONFIRMED:       'Confirmed',
  AMEND_REQUESTED: 'Amendment Sent',
  AMENDED:         'Amended',
  CANCEL_REQUESTED:'Cancellation Sent',
  CANCELLED:       'Cancelled',
  NO_SHOW:         'No Show',
  WAITLISTED:      'Waitlisted',
  REJECTED:        'Rejected',
}

/** Tailwind class per status, matching the palette the rest of the app uses. */
export const STATUS_STYLES: Record<ReservationStatusValue, string> = {
  REQUESTED:        'bg-slate-100 text-slate-700 border-slate-200',
  QUOTING:          'bg-sky-100 text-sky-800 border-sky-200',
  OPTION_HELD:      'bg-amber-100 text-amber-900 border-amber-200',
  PENDING_HOTEL:    'bg-violet-100 text-violet-800 border-violet-200',
  CONFIRMED:        'bg-emerald-100 text-emerald-800 border-emerald-200',
  AMEND_REQUESTED:  'bg-orange-100 text-orange-800 border-orange-200',
  AMENDED:          'bg-teal-100 text-teal-800 border-teal-200',
  CANCEL_REQUESTED: 'bg-rose-100 text-rose-800 border-rose-200',
  CANCELLED:        'bg-zinc-200 text-zinc-700 border-zinc-300',
  NO_SHOW:          'bg-red-100 text-red-800 border-red-200',
  WAITLISTED:       'bg-indigo-100 text-indigo-800 border-indigo-200',
  REJECTED:         'bg-red-100 text-red-800 border-red-200',
}

/** Statuses where the stay is no longer being worked. */
export const TERMINAL_STATUSES: ReservationStatusValue[] = [
  'CANCELLED', 'REJECTED', 'NO_SHOW',
]

/** Statuses where we hold a commitment from the property. */
export const SECURED_STATUSES: ReservationStatusValue[] = ['CONFIRMED', 'AMENDED']

export const MEAL_PLAN_LABELS: Record<MealPlanValue, string> = {
  RO: 'Room Only',
  BB: 'Bed & Breakfast',
  HB: 'Half Board',
  FB: 'Full Board',
  AI: 'All Inclusive',
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export function startOfUtcDay(d: Date | string): Date {
  const date = typeof d === 'string' ? new Date(d) : d
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Whole days from `from` to `to`, negative when `to` is in the past. */
export function daysBetween(from: Date | string, to: Date | string): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS)
}

export function nightsBetween(checkIn: Date | string, checkOut: Date | string): number {
  return Math.max(0, daysBetween(checkIn, checkOut))
}

/** Hours between two instants, or null when either is missing. */
export function hoursSince(then: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!then) return null
  const t = typeof then === 'string' ? new Date(then) : then
  if (Number.isNaN(t.getTime())) return null
  return (now.getTime() - t.getTime()) / 3_600_000
}

// ─── Stay identity ───────────────────────────────────────────────────────────

/**
 * Normalise a hotel name for joining. Kept byte-compatible with
 * `normalizeHotelName()` in `hotel-match.ts` so a reservation and a
 * reconfirmation built from the same accommodation row produce the same key.
 */
export function normalizeForKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
}

/** `BOOKINGREF::normalised-hotel::YYYY-MM-DD`. Stable across amendments. */
export function buildReservationKey(bookingRef: string, hotelName: string, checkIn: Date | string): string {
  const day = startOfUtcDay(checkIn).toISOString().slice(0, 10)
  return `${bookingRef.trim().toUpperCase()}::${normalizeForKey(hotelName)}::${day}`
}

// ─── Money ───────────────────────────────────────────────────────────────────

/** Anything Prisma might hand back for a Decimal column. */
export type Numeric = number | string | { toString(): string } | null | undefined

export function toNumber(v: Numeric): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v.toString())
  return Number.isFinite(n) ? n : null
}

/**
 * Total cost of a stay: nett rate is per room per night.
 *
 * Returned in the quoted currency. The USD equivalent is a separate step
 * (`toBase`) so a missing FX rate degrades to "unknown in USD" rather than
 * silently pretending the local figure is dollars.
 */
export function stayTotal(nettRate: Numeric, roomCount: number, nights: number): number | null {
  const rate = toNumber(nettRate)
  if (rate === null) return null
  const rooms = Math.max(1, roomCount || 1)
  const n = Math.max(0, nights || 0)
  return round2(rate * rooms * n)
}

/** Convert a quoted figure to the USD base. Null when no rate is known. */
export function toBase(amount: Numeric, fxRate: Numeric): number | null {
  const a = toNumber(amount)
  const r = toNumber(fxRate)
  if (a === null) return null
  if (r === null || r === 0) return null
  return round2(a * r)
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function formatMoney(amount: Numeric, currency = 'USD'): string {
  const n = toNumber(amount)
  if (n === null) return '—'
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Variance of a cost against its budget.
 *
 * `pct` is null when the budget is zero or unknown — a percentage against no
 * budget is meaningless and must not render as 0%.
 */
export function budgetVariance(cost: Numeric, budget: Numeric): { abs: number | null; pct: number | null } {
  const c = toNumber(cost)
  const b = toNumber(budget)
  if (c === null || b === null) return { abs: null, pct: null }
  const abs = round2(c - b)
  return { abs, pct: b === 0 ? null : round2((abs / b) * 100) }
}

// ─── Cancellation policy ─────────────────────────────────────────────────────

/**
 * One rung of a cancellation ladder.
 *
 * `fromDaysBefore` is the number of days before check-in at which the rung
 * starts applying. `pct` is a percentage of the stay total; `amount` is a flat
 * figure in the stay's currency. When both are set, the larger wins — that is
 * how properties usually word "50% or one night, whichever is greater".
 */
export interface PenaltyTier {
  fromDaysBefore: number
  pct?: number | null
  amount?: number | null
  note?: string | null
}

export function parsePenaltyTiers(raw: unknown): PenaltyTier[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map(t => ({
      fromDaysBefore: Number(t.fromDaysBefore ?? 0),
      pct: t.pct == null ? null : Number(t.pct),
      amount: t.amount == null ? null : Number(t.amount),
      note: typeof t.note === 'string' ? t.note : null,
    }))
    .filter(t => Number.isFinite(t.fromDaysBefore))
    // Nearest rung to check-in first, so the first match is the tightest one.
    .sort((a, b) => a.fromDaysBefore - b.fromDaysBefore)
}

export interface PenaltyQuote {
  /** Cost of cancelling on `asOf`, in the stay's currency. */
  amount: number
  /** Null when nothing is chargeable, otherwise the rung that applied. */
  tier: PenaltyTier | null
  /** True while the stay is still inside its free-cancellation window. */
  free: boolean
  daysToCheckIn: number
  explanation: string
}

/**
 * What cancelling this stay costs today.
 *
 * The whole point of showing this *before* anything is sent: the team should
 * see "this costs USD 420" while they can still choose not to.
 */
export function quoteCancellation(params: {
  checkIn: Date | string
  totalCost: Numeric
  currency?: string
  freeCancelUntil?: Date | string | null
  penaltyTiers?: unknown
  asOf?: Date
}): PenaltyQuote {
  const asOf = params.asOf ?? new Date()
  const daysToCheckIn = daysBetween(asOf, params.checkIn)
  const total = toNumber(params.totalCost) ?? 0
  const currency = params.currency ?? 'USD'
  const tiers = parsePenaltyTiers(params.penaltyTiers)

  if (params.freeCancelUntil) {
    const free = startOfUtcDay(params.freeCancelUntil)
    if (startOfUtcDay(asOf).getTime() <= free.getTime()) {
      return {
        amount: 0,
        tier: null,
        free: true,
        daysToCheckIn,
        explanation: `Free until ${free.toISOString().slice(0, 10)} — cancelling today costs nothing.`,
      }
    }
  }

  // Tiers are sorted nearest-first; the first whose window we are inside wins.
  const tier = tiers.find(t => daysToCheckIn <= t.fromDaysBefore) ?? null

  if (!tier) {
    if (tiers.length === 0) {
      return {
        amount: 0,
        tier: null,
        free: false,
        daysToCheckIn,
        explanation: 'No cancellation ladder captured for this stay — confirm the terms with the property before cancelling.',
      }
    }
    return {
      amount: 0,
      tier: null,
      free: true,
      daysToCheckIn,
      explanation: `${daysToCheckIn} day(s) to check-in — outside every penalty band.`,
    }
  }

  const byPct = tier.pct != null ? round2((total * tier.pct) / 100) : null
  const flat = tier.amount != null ? round2(tier.amount) : null
  const amount = Math.max(byPct ?? 0, flat ?? 0)

  const parts: string[] = []
  if (byPct != null) parts.push(`${tier.pct}% of ${formatMoney(total, currency)}`)
  if (flat != null) parts.push(`flat ${formatMoney(flat, currency)}`)

  return {
    amount,
    tier,
    free: amount === 0,
    daysToCheckIn,
    explanation:
      `${daysToCheckIn} day(s) to check-in — inside the ${tier.fromDaysBefore}-day band. ` +
      `Charge: ${parts.join(' or ') || 'per property terms'}` +
      (tier.note ? ` (${tier.note})` : '') + '.',
  }
}

/** Free-cancellation date implied by a contract's `freeCancelDays`. */
export function freeCancelDateFrom(checkIn: Date | string, freeCancelDays: number | null | undefined): Date | null {
  if (freeCancelDays == null || !Number.isFinite(freeCancelDays)) return null
  return new Date(startOfUtcDay(checkIn).getTime() - freeCancelDays * DAY_MS)
}

// ─── Urgency ─────────────────────────────────────────────────────────────────

/** Classify any deadline into the shared colour language. */
export function classifyDeadline(due: Date | string | null | undefined, asOf: Date = new Date()): Urgency {
  if (!due) return 'later'
  const days = daysBetween(asOf, due)
  if (days < 0) return 'overdue'
  if (days <= 1) return 'critical'
  if (days <= 3) return 'soon'
  return 'later'
}

export const URGENCY_STYLES: Record<Urgency, string> = {
  overdue:  'bg-red-100 text-red-800 border-red-300',
  critical: 'bg-orange-100 text-orange-800 border-orange-300',
  soon:     'bg-amber-100 text-amber-900 border-amber-300',
  later:    'bg-slate-100 text-slate-700 border-slate-200',
  done:     'bg-emerald-100 text-emerald-800 border-emerald-200',
}

export const URGENCY_RANK: Record<Urgency, number> = {
  overdue: 0, critical: 1, soon: 2, later: 3, done: 4,
}

/** Ageing bucket for credit notes and unpaid invoices. */
export function ageingBucket(days: number): '0-30' | '31-60' | '61-90' | '90+' {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

// ─── Occupancy ───────────────────────────────────────────────────────────────

/**
 * Whether the booked rooms can physically hold the party.
 *
 * Deliberately generous — three to a room is legal in most of the region — but
 * it catches the real error, which is 6 pax against 1 room.
 */
export function occupancyCheck(params: {
  roomCount: number
  adults: number
  children: number
  cwb: number
  cnb: number
}): { ok: boolean; capacity: number; heads: number } {
  const rooms = Math.max(1, params.roomCount || 1)
  const capacity = rooms * 3
  // Infants are excluded; a child with a bed occupies one, a child without does not.
  const heads = (params.adults || 0) + (params.cwb || 0) +
    Math.max(0, (params.children || 0) - (params.cwb || 0) - (params.cnb || 0))
  return { ok: heads <= capacity, capacity, heads }
}
