import type { BookingStatus, UserRole } from '@prisma/client'

export type Transition = {
  from: BookingStatus | BookingStatus[]
  to: BookingStatus
  allowedRoles: UserRole[]
  label: string
  requiresNote?: boolean
  guard?: string
}

// All valid state transitions — Method 1: Manual Vietnam Credit-base Agents
export const TRANSITIONS: Transition[] = [
  {
    from: 'DRAFT',
    to: 'BT_CONFIRMED',
    allowedRoles: ['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Confirm Booking',
  },
  {
    from: 'BT_CONFIRMED',
    to: 'GT_REVIEW',
    allowedRoles: ['BT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Submit to Travel Experience',
  },
  {
    from: 'GT_REVIEW',
    to: 'CHANGE_REQUESTED',
    allowedRoles: ['TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Request Changes',
    requiresNote: true,
  },
  {
    from: 'CHANGE_REQUESTED',
    to: 'BT_CONFIRMED',
    allowedRoles: ['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Resubmit after Correction',
    requiresNote: true,
  },
  {
    from: 'GT_REVIEW',
    to: 'GT_VERIFIED',
    allowedRoles: ['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Client Confirmed',
  },
  {
    from: 'GT_VERIFIED',
    to: 'OPERATIONS_READY',
    allowedRoles: ['GT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Mark Operations Ready',
  },
  {
    from: 'OPERATIONS_READY',
    to: 'CLIENT_LIVE',
    allowedRoles: ['GT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Open Client Portal',
  },
  {
    from: 'CLIENT_LIVE',
    to: 'IN_PROGRESS',
    allowedRoles: ['GT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Mark In Progress',
  },
  // ── Post-trip operations checklist ──────────────────────────────────────
  {
    from: 'IN_PROGRESS',
    to: 'TE_REVIEWED',
    allowedRoles: ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'TE Reviewed',
  },
  {
    from: 'TE_REVIEWED',
    to: 'DRIVER_ALLOCATED',
    allowedRoles: ['GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Driver Allocated',
  },
  {
    from: 'DRIVER_ALLOCATED',
    to: 'QC1_PASS',
    allowedRoles: ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'QC1 Pass',
  },
  {
    from: 'QC1_PASS',
    to: 'TICKETS_ISSUED',
    allowedRoles: ['TE_USER', 'GT_TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Tickets Issued (Activated)',
  },
  {
    from: 'TICKETS_ISSUED',
    to: 'QC2_PASS',
    allowedRoles: ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'QC2 Pass',
  },
  {
    from: 'QC2_PASS',
    to: 'MSG_SENT_CUSTOMER',
    allowedRoles: ['TE_USER', 'GT_TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Message Sent to Customer',
  },
  {
    from: 'MSG_SENT_CUSTOMER',
    to: 'FEEDBACK_DONE',
    allowedRoles: ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Feedback Done',
  },
  {
    from: 'FEEDBACK_DONE',
    to: 'COMPLETED',
    allowedRoles: ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
    label: 'Complete Trip',
  },
]

// Cancellation — allowed from any pre-completion state
export const CANCELLABLE_STATES: BookingStatus[] = [
  'DRAFT', 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED',
  'GT_VERIFIED', 'AWAITING_PAYMENT_CONFIRM', 'OPERATIONS_READY', 'CLIENT_LIVE',
  'IN_PROGRESS', 'TE_REVIEWED', 'DRIVER_ALLOCATED', 'QC1_PASS',
  'TICKETS_ISSUED', 'QC2_PASS', 'MSG_SENT_CUSTOMER', 'FEEDBACK_DONE',
]

export const STATUS_LABELS: Record<BookingStatus, string> = {
  DRAFT: 'Draft',
  BT_CONFIRMED: 'Booking Confirmed',
  GT_REVIEW: 'Need Review by TE Team',
  CHANGE_REQUESTED: 'Changes Requested',
  GT_VERIFIED: 'Client Confirmed',
  AWAITING_PAYMENT_CONFIRM: 'Awaiting Payment',
  OPERATIONS_READY: 'Operations Ready',
  CLIENT_LIVE: 'Client Portal Live',
  IN_PROGRESS: 'In Progress',
  TE_REVIEWED: 'TE Reviewed',
  DRIVER_ALLOCATED: 'Driver Allocated',
  QC1_PASS: 'QC1 Pass',
  TICKETS_ISSUED: 'Tickets Issued',
  QC2_PASS: 'QC2 Pass',
  MSG_SENT_CUSTOMER: 'Message Sent to Customer',
  FEEDBACK_DONE: 'Feedback Done',
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
  TE_REVIEWED: 'bg-cyan-100 text-cyan-700',
  DRIVER_ALLOCATED: 'bg-sky-100 text-sky-700',
  QC1_PASS: 'bg-violet-100 text-violet-700',
  TICKETS_ISSUED: 'bg-fuchsia-100 text-fuchsia-700',
  QC2_PASS: 'bg-pink-100 text-pink-700',
  MSG_SENT_CUSTOMER: 'bg-rose-100 text-rose-700',
  FEEDBACK_DONE: 'bg-lime-100 text-lime-700',
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
// hidden: true steps are tracked for step ordering but not shown in the progress bar
export const LIFECYCLE_STEPS: { status: BookingStatus; label: string; step: number; hidden?: boolean }[] = [
  { status: 'DRAFT',                    label: 'Draft',                 step: 1,  hidden: true },
  { status: 'BT_CONFIRMED',             label: 'Booking Creating',      step: 2 },
  { status: 'GT_REVIEW',                label: 'TE Reviewing',          step: 3 },
  { status: 'GT_VERIFIED',              label: 'Verified',              step: 4 },
  { status: 'AWAITING_PAYMENT_CONFIRM', label: 'P&L',                   step: 5 },
  { status: 'OPERATIONS_READY',         label: 'Ops Ready',             step: 6,  hidden: true },
  { status: 'CLIENT_LIVE',              label: 'Client Live',           step: 7,  hidden: true },
  { status: 'IN_PROGRESS',              label: 'In Progress',           step: 8,  hidden: true },
  { status: 'TE_REVIEWED',              label: 'TE Reviewed',           step: 9,  hidden: true },
  { status: 'DRIVER_ALLOCATED',         label: 'Drivers Allocated',     step: 10 },
  { status: 'QC1_PASS',                 label: 'QC1 Pass',              step: 11 },
  { status: 'TICKETS_ISSUED',           label: 'Tickets Added',         step: 12 },
  { status: 'QC2_PASS',                 label: 'QC2 Pass',              step: 13, hidden: true },
  { status: 'MSG_SENT_CUSTOMER',        label: 'Msg Sent',              step: 14 },
  { status: 'FEEDBACK_DONE',            label: 'Feedback getting Done', step: 15 },
  { status: 'COMPLETED',                label: 'Travel Completed',      step: 16 },
]

export function getCurrentStep(status: BookingStatus): number {
  return LIFECYCLE_STEPS.find(s => s.status === status)?.step ?? 0
}
