/**
 * The pre-confirmation accuracy gate.
 *
 * Nothing reaches CONFIRMED without passing through here. Blocking checks are
 * facts that must be true before we promise a guest a room; warnings are things
 * a human may knowingly accept, but only with a reason recorded against their
 * name.
 *
 * Pure: it takes a snapshot of the stay and its context and returns a verdict.
 * The write layer runs it, stores the verdict in `HotelReservation.gateSnapshot`
 * and refuses the transition when `blocked` is true. Storing the verdict is the
 * point — it is the evidence that the check actually ran, and what was waived.
 */
import {
  budgetVariance, daysBetween, nightsBetween, occupancyCheck,
  toNumber, type Numeric,
} from './reservation-shared'

export type CheckSeverity = 'block' | 'warn'

export interface GateCheck {
  id: string
  severity: CheckSeverity
  label: string
  passed: boolean
  /** Shown when the check fails — says what is wrong, not merely that it is. */
  detail?: string
}

export interface GateInput {
  checkIn: Date | string
  checkOut: Date | string
  roomCount: number
  adults: number
  children: number
  cwb: number
  cnb: number
  infants: number
  leadGuestName?: string | null
  nettRate: Numeric
  currency?: string | null
  totalCost: Numeric
  confirmationNumber?: string | null
  policyText?: string | null
  penaltyTiers?: unknown
  freeCancelUntil?: Date | string | null
  budgetAmount?: Numeric
  /** The accommodation row this stay is meant to mirror, when one resolved. */
  accommodation?: { checkIn: Date | string; checkOut: Date | string; hotel: string } | null
  /** Passenger names on the booking, for the lead-guest check. */
  passengerNames?: string[]
  /** True when the hotel profile has at least one verified contact channel. */
  hotelContactVerified?: boolean
  /** True when a live contract covers these dates. */
  contractCovers?: boolean
  /** Other stays on the same booking, to catch a double-booked night. */
  siblingStays?: { id: string; hotelName: string; checkIn: Date | string; checkOut: Date | string }[]
  /** The reservation being checked, excluded from the overlap test. */
  selfId?: string
}

export interface GateResult {
  checks: GateCheck[]
  /** Failing blocking checks — the transition is refused while any remain. */
  blockers: GateCheck[]
  /** Failing warnings — allowed through, but each needs a written reason. */
  warnings: GateCheck[]
  blocked: boolean
  passedAll: boolean
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function sameDay(a: Date | string, b: Date | string): boolean {
  return daysBetween(a, b) === 0
}

/** Do two date ranges share at least one night? */
function overlaps(aIn: Date | string, aOut: Date | string, bIn: Date | string, bOut: Date | string): boolean {
  return daysBetween(aIn, bOut) > 0 && daysBetween(bIn, aOut) > 0
}

export function runAccuracyGate(input: GateInput): GateResult {
  const checks: GateCheck[] = []
  const add = (c: GateCheck) => checks.push(c)

  // ── Blocking ──────────────────────────────────────────────────────────────

  const nights = nightsBetween(input.checkIn, input.checkOut)
  add({
    id: 'dates_sane',
    severity: 'block',
    label: 'Check-out is after check-in',
    passed: nights > 0,
    detail: nights > 0 ? undefined : 'Check-out is on or before check-in — the stay is zero nights.',
  })

  if (input.accommodation) {
    const inMatch = sameDay(input.checkIn, input.accommodation.checkIn)
    const outMatch = sameDay(input.checkOut, input.accommodation.checkOut)
    add({
      id: 'dates_match_booking',
      severity: 'block',
      label: 'Dates match the booking’s accommodation line',
      passed: inMatch && outMatch,
      detail: inMatch && outMatch ? undefined :
        `Booking says ${String(input.accommodation.checkIn).slice(0, 10)} → ${String(input.accommodation.checkOut).slice(0, 10)}; ` +
        `this reservation says ${String(input.checkIn).slice(0, 10)} → ${String(input.checkOut).slice(0, 10)}.`,
    })
  } else {
    add({
      id: 'dates_match_booking',
      severity: 'warn',
      label: 'Dates match the booking’s accommodation line',
      passed: false,
      detail: 'No accommodation line on the booking resolved to this stay — nothing to compare against.',
    })
  }

  const occ = occupancyCheck(input)
  add({
    id: 'occupancy',
    severity: 'block',
    label: 'Rooms cover the party',
    passed: occ.ok,
    detail: occ.ok ? undefined :
      `${occ.heads} guest(s) needing a bed against ${input.roomCount} room(s) (capacity ~${occ.capacity}).`,
  })

  const lead = (input.leadGuestName ?? '').trim()
  const names = input.passengerNames ?? []
  const leadMatches = lead.length > 0 && (names.length === 0 || names.some(n => norm(n) === norm(lead)))
  add({
    id: 'lead_guest',
    severity: 'block',
    label: 'Lead guest named, and on the booking',
    passed: leadMatches,
    detail: lead.length === 0
      ? 'No lead guest recorded — the property needs a name to hold the room under.'
      : leadMatches ? undefined
      : `“${lead}” does not match any passenger on this booking.`,
  })

  const rate = toNumber(input.nettRate)
  add({
    id: 'rate_set',
    severity: 'block',
    label: 'Nett rate and currency captured',
    passed: rate !== null && rate > 0 && !!input.currency,
    detail: rate !== null && rate > 0 && !!input.currency ? undefined
      : 'A confirmed stay with no agreed rate cannot be reconciled against an invoice later.',
  })

  const hasPolicy = !!(input.policyText && input.policyText.trim()) ||
    (Array.isArray(input.penaltyTiers) && input.penaltyTiers.length > 0) ||
    !!input.freeCancelUntil
  add({
    id: 'policy_captured',
    severity: 'block',
    label: 'Cancellation policy captured',
    passed: hasPolicy,
    detail: hasPolicy ? undefined
      : 'Without the terms we cannot tell the team what cancelling costs, and cannot dispute a penalty.',
  })

  const conf = (input.confirmationNumber ?? '').trim()
  add({
    id: 'confirmation_number',
    severity: 'block',
    label: 'Confirmation number entered',
    passed: conf.length > 0,
    detail: conf.length > 0 ? undefined : 'The property’s own reference is what makes this stay provable at check-in.',
  })

  // ── Warnings ──────────────────────────────────────────────────────────────

  if (input.budgetAmount != null) {
    const v = budgetVariance(input.totalCost, input.budgetAmount)
    const over = v.abs !== null && v.abs > 0
    add({
      id: 'within_budget',
      severity: 'warn',
      label: 'Within the P&L hotel budget',
      passed: !over,
      detail: over
        ? `Over budget by ${v.abs}${v.pct !== null ? ` (${v.pct}%)` : ''}.`
        : undefined,
    })
  }

  if (input.freeCancelUntil) {
    const window = daysBetween(new Date(), input.freeCancelUntil)
    add({
      id: 'cancel_window',
      severity: 'warn',
      label: 'Free-cancellation window of at least 7 days',
      passed: window >= 7,
      detail: window >= 7 ? undefined
        : `Only ${window} day(s) of free cancellation remain — the stay is effectively committed.`,
    })
  }

  add({
    id: 'hotel_contact_verified',
    severity: 'warn',
    label: 'Hotel has a verified contact channel',
    passed: input.hotelContactVerified !== false,
    detail: input.hotelContactVerified === false
      ? 'No verified phone or WhatsApp for this property — a reconfirmation at D-10 may not reach anyone.'
      : undefined,
  })

  add({
    id: 'contract_covers',
    severity: 'warn',
    label: 'A live contract covers these dates',
    passed: input.contractCovers !== false,
    detail: input.contractCovers === false
      ? 'No active contract spans this stay — the rate is ad-hoc and the policy is whatever was written down here.'
      : undefined,
  })

  const clashes = (input.siblingStays ?? []).filter(
    s => s.id !== input.selfId && overlaps(input.checkIn, input.checkOut, s.checkIn, s.checkOut),
  )
  add({
    id: 'no_overlap',
    severity: 'warn',
    label: 'No other stay on this booking overlaps',
    passed: clashes.length === 0,
    detail: clashes.length
      ? `Overlaps ${clashes.map(c => `${c.hotelName} (${String(c.checkIn).slice(0, 10)})`).join(', ')} — the guest cannot be in two hotels at once.`
      : undefined,
  })

  const blockers = checks.filter(c => c.severity === 'block' && !c.passed)
  const warnings = checks.filter(c => c.severity === 'warn' && !c.passed)

  return {
    checks,
    blockers,
    warnings,
    blocked: blockers.length > 0,
    passedAll: blockers.length === 0 && warnings.length === 0,
  }
}

/**
 * The snapshot stored on the reservation at confirmation.
 *
 * Records the reasons given for each waived warning, keyed by check id, so a
 * later reader can see not only that a warning was overridden but why.
 */
export interface GateSnapshot {
  ranAt: string
  ranBy?: string | null
  checks: GateCheck[]
  waived: { id: string; label: string; reason: string }[]
}

export function buildGateSnapshot(
  result: GateResult,
  waivers: Record<string, string>,
  actorEmail?: string | null,
): GateSnapshot {
  return {
    ranAt: new Date().toISOString(),
    ranBy: actorEmail ?? null,
    checks: result.checks,
    waived: result.warnings.map(w => ({
      id: w.id,
      label: w.label,
      reason: waivers[w.id]?.trim() || '(no reason given)',
    })),
  }
}

/** Warnings still lacking a written reason. Empty means the gate may proceed. */
export function missingWaivers(result: GateResult, waivers: Record<string, string>): GateCheck[] {
  return result.warnings.filter(w => !(waivers[w.id]?.trim()))
}
