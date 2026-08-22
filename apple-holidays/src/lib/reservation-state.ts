/**
 * Reservation lifecycle — the single source of truth for which roles may move a
 * hotel reservation from one status to the next.
 *
 * Same shape as `state-machine.ts` so the UI can render transition buttons
 * generically, and so a reader who knows the booking flow already knows this
 * one. It is deliberately INDEPENDENT of `BookingStatus`: a booking can sit at
 * GT_VERIFIED with three hotels confirmed and a fourth still awaiting a reply.
 */
import type { UserRole } from '@prisma/client'
import type { ReservationStatusValue } from './reservation-shared'

export type ReservationTransition = {
  from: ReservationStatusValue | ReservationStatusValue[]
  to: ReservationStatusValue
  allowedRoles: UserRole[]
  label: string
  /** The write layer rejects the move without a note. */
  requiresNote?: boolean
  /** Named guard evaluated in `reservations-write.ts`. */
  guard?: 'accuracyGate' | 'holdInFuture' | 'penaltyAcknowledged'
  /** Rendered as a destructive action in the UI. */
  danger?: boolean
}

/** Everyone who works reservations. Admins are appended to every row below. */
const RS = ['RS_USER'] as UserRole[]
const ADMIN = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'] as UserRole[]
const RS_ADMIN = [...RS, ...ADMIN]

export const RESERVATION_TRANSITIONS: ReservationTransition[] = [
  {
    from: ['REQUESTED', 'REJECTED'],
    to: 'QUOTING',
    allowedRoles: RS_ADMIN,
    label: 'Start Quoting',
  },
  {
    from: ['QUOTING', 'REQUESTED'],
    to: 'PENDING_HOTEL',
    allowedRoles: RS_ADMIN,
    label: 'Send to Hotel',
  },
  {
    from: ['QUOTING', 'PENDING_HOTEL'],
    to: 'OPTION_HELD',
    allowedRoles: RS_ADMIN,
    label: 'Hotel Holding Option',
    guard: 'holdInFuture',
  },
  {
    from: ['OPTION_HELD', 'PENDING_HOTEL', 'QUOTING', 'WAITLISTED', 'AMEND_REQUESTED'],
    to: 'CONFIRMED',
    allowedRoles: RS_ADMIN,
    label: 'Confirm Reservation',
    guard: 'accuracyGate',
  },
  {
    from: 'PENDING_HOTEL',
    to: 'WAITLISTED',
    allowedRoles: RS_ADMIN,
    label: 'Waitlisted by Hotel',
    requiresNote: true,
  },
  {
    from: ['QUOTING', 'PENDING_HOTEL', 'OPTION_HELD'],
    to: 'REJECTED',
    allowedRoles: RS_ADMIN,
    label: 'No Availability',
    requiresNote: true,
    danger: true,
  },
  {
    from: ['OPTION_HELD', 'QUOTING', 'PENDING_HOTEL'],
    to: 'REQUESTED',
    allowedRoles: RS_ADMIN,
    label: 'Release / Reset to Requested',
    requiresNote: true,
  },
  // ── Amendments ────────────────────────────────────────────────────────────
  {
    from: ['CONFIRMED', 'AMENDED'],
    to: 'AMEND_REQUESTED',
    allowedRoles: RS_ADMIN,
    label: 'Request Amendment',
    requiresNote: true,
  },
  {
    from: 'AMEND_REQUESTED',
    to: 'AMENDED',
    allowedRoles: RS_ADMIN,
    label: 'Hotel Confirmed Amendment',
  },
  {
    from: 'AMENDED',
    to: 'CONFIRMED',
    allowedRoles: RS_ADMIN,
    label: 'Re-confirm Stay',
    guard: 'accuracyGate',
  },
  // ── Cancellation ──────────────────────────────────────────────────────────
  {
    from: ['CONFIRMED', 'AMENDED', 'OPTION_HELD', 'PENDING_HOTEL', 'AMEND_REQUESTED', 'WAITLISTED'],
    to: 'CANCEL_REQUESTED',
    allowedRoles: RS_ADMIN,
    label: 'Request Cancellation',
    requiresNote: true,
    danger: true,
  },
  {
    from: ['CANCEL_REQUESTED', 'REQUESTED', 'QUOTING'],
    to: 'CANCELLED',
    allowedRoles: RS_ADMIN,
    label: 'Cancellation Confirmed',
    requiresNote: true,
    guard: 'penaltyAcknowledged',
    danger: true,
  },
  {
    from: ['CONFIRMED', 'AMENDED'],
    to: 'NO_SHOW',
    allowedRoles: RS_ADMIN,
    label: 'Mark No-Show',
    requiresNote: true,
    danger: true,
  },
]

function fromList(t: ReservationTransition): ReservationStatusValue[] {
  return Array.isArray(t.from) ? t.from : [t.from]
}

/** Transitions this role may take from this status. */
export function getAvailableTransitions(
  status: ReservationStatusValue,
  role: UserRole,
): ReservationTransition[] {
  return RESERVATION_TRANSITIONS.filter(
    t => fromList(t).includes(status) && t.allowedRoles.includes(role),
  )
}

export function findTransition(
  from: ReservationStatusValue,
  to: ReservationStatusValue,
): ReservationTransition | undefined {
  return RESERVATION_TRANSITIONS.find(t => fromList(t).includes(from) && t.to === to)
}

export function canTransition(
  from: ReservationStatusValue,
  to: ReservationStatusValue,
  role: UserRole,
): boolean {
  const t = findTransition(from, to)
  return !!t && t.allowedRoles.includes(role)
}
