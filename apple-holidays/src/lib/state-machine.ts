import type { BookingStatus, UserRole } from '@prisma/client'

export type Transition = {
  from: BookingStatus | BookingStatus[]
  to: BookingStatus
  allowedRoles: UserRole[]
  label: string
  requiresNote?: boolean
  guard?: string
}

// All valid state transitions
export const TRANSITIONS: Transition[] = [
  {
    from: 'DRAFT',
    to: 'BT_CONFIRMED',
    allowedRoles: ['BT_USER', 'SUPER_ADMIN'],
    label: 'Confirm Booking',
  },
  {
    from: 'BT_CONFIRMED',
    to: 'GT_REVIEW',
    allowedRoles: ['BT_USER', 'SUPER_ADMIN'],
    label: 'Submit to Ground Team',
  },
  {
    from: 'GT_REVIEW',
    to: 'CHANGE_REQUESTED',
    allowedRoles: ['GT_USER', 'SUPER_ADMIN'],
    label: 'Request Changes',
    requiresNote: true,
    guard: 'G1',
  },
  {
    from: 'GT_REVIEW',
    to: 'GT_VERIFIED',
    allowedRoles: ['GT_USER', 'SUPER_ADMIN'],
    label: 'Verify & Approve',
  },
  {
    from: 'CHANGE_REQUESTED',
    to: 'BT_CONFIRMED',
    allowedRoles: ['BT_USER', 'SUPER_ADMIN'],
    label: 'Resubmit after Correction',
    requiresNote: true,
  },
  {
    from: 'GT_VERIFIED',
    to: 'AWAITING_PAYMENT_CONFIRM',
    allowedRoles: ['AC_USER', 'SUPER_ADMIN'],
    label: 'Upload P&L / Await Payment',
  },
  {
    from: 'AWAITING_PAYMENT_CONFIRM',
    to: 'OPERATIONS_READY',
    allowedRoles: ['AC_USER', 'SUPER_ADMIN'],
    label: 'Confirm All Payments',
    guard: 'G2',
  },
  {
    from: 'OPERATIONS_READY',
    to: 'CLIENT_LIVE',
    allowedRoles: ['GT_USER', 'TE_USER', 'SUPER_ADMIN'],
    label: 'Open Client Portal (T−5)',
    guard: 'G4',
  },
  {
    from: 'CLIENT_LIVE',
    to: 'IN_PROGRESS',
    allowedRoles: ['GT_USER', 'TE_USER', 'SUPER_ADMIN'],
    label: 'Mark In Progress',
  },
  {
    from: 'IN_PROGRESS',
    to: 'COMPLETED',
    allowedRoles: ['GT_USER', 'TE_USER', 'SUPER_ADMIN'],
    label: 'Complete Trip',
  },
]

// Cancellation — allowed from any pre-trip state
export const CANCELLABLE_STATES: BookingStatus[] = [
  'DRAFT', 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED',
  'GT_VERIFIED', 'AWAITING_PAYMENT_CONFIRM', 'OPERATIONS_READY', 'CLIENT_LIVE',
]

export const STATUS_LABELS: Record<BookingStatus, string> = {
  DRAFT: 'Draft',
  BT_CONFIRMED: 'Booking Confirmed',
  GT_REVIEW: 'Ground Review',
  CHANGE_REQUESTED: 'Changes Requested',
  GT_VERIFIED: 'Ground Verified',
  AWAITING_PAYMENT_CONFIRM: 'Awaiting Payment',
  OPERATIONS_READY: 'Operations Ready',
  CLIENT_LIVE: 'Client Portal Live',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  AMENDED: 'Amended',
}

export const STATUS_COLORS: Record<BookingStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  BT_CONFIRMED: 'bg-blue-100 text-blue-700',
  GT_REVIEW: 'bg-yellow-100 text-yellow-700',
  CHANGE_REQUESTED: 'bg-orange-100 text-orange-700',
  GT_VERIFIED: 'bg-teal-100 text-teal-700',
  AWAITING_PAYMENT_CONFIRM: 'bg-purple-100 text-purple-700',
  OPERATIONS_READY: 'bg-indigo-100 text-indigo-700',
  CLIENT_LIVE: 'bg-green-100 text-green-700',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-gray-100 text-gray-500',
  CANCELLED: 'bg-red-100 text-red-700',
  AMENDED: 'bg-amber-100 text-amber-700',
}

export function getAvailableTransitions(
  currentStatus: BookingStatus,
  role: UserRole,
): Transition[] {
  return TRANSITIONS.filter(t => {
    const fromMatch = Array.isArray(t.from)
      ? t.from.includes(currentStatus)
      : t.from === currentStatus
    return fromMatch && t.allowedRoles.includes(role)
  })
}

export function canTransition(
  from: BookingStatus,
  to: BookingStatus,
  role: UserRole,
): boolean {
  return TRANSITIONS.some(t => {
    const fromMatch = Array.isArray(t.from)
      ? t.from.includes(from)
      : t.from === from
    return fromMatch && t.to === to && t.allowedRoles.includes(role)
  })
}

// Booking lifecycle steps for the timeline UI
export const LIFECYCLE_STEPS: { status: BookingStatus; label: string; step: number }[] = [
  { status: 'DRAFT', label: 'Draft', step: 1 },
  { status: 'BT_CONFIRMED', label: 'Booking Confirmed', step: 2 },
  { status: 'GT_REVIEW', label: 'Ground Review', step: 3 },
  { status: 'GT_VERIFIED', label: 'Verified', step: 4 },
  { status: 'AWAITING_PAYMENT_CONFIRM', label: 'Payment Confirm', step: 5 },
  { status: 'OPERATIONS_READY', label: 'Operations Ready', step: 6 },
  { status: 'CLIENT_LIVE', label: 'Client Live', step: 7 },
  { status: 'IN_PROGRESS', label: 'In Progress', step: 8 },
  { status: 'COMPLETED', label: 'Completed', step: 9 },
]

export function getCurrentStep(status: BookingStatus): number {
  return LIFECYCLE_STEPS.find(s => s.status === status)?.step ?? 0
}
