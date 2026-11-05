/**
 * Which buttons the booking page shows this person — the same derivation as
 * dashboard/bookings/[ref]/page.tsx, so the app offers exactly the web's actions.
 */
import type { BookingStatus, UserRole } from '@prisma/client'
import { getAvailableTransitions, STATUS_LABELS } from '@/lib/state-machine'

const ADVANCE_STEPS: BookingStatus[] = ['TE_REVIEWED', 'DRIVER_ALLOCATED', 'TICKETS_ISSUED', 'MSG_SENT_CUSTOMER', 'FEEDBACK_DONE']

export interface BookingAction {
  to: BookingStatus
  label: string
  /** POST /api/bookings/[ref]/<endpoint> */
  endpoint: string
  body: Record<string, unknown>
  /** a note must be typed first (change request / resubmit / client confirm) */
  needsNote: boolean
  /** opens the feedback form (rating + comment → /feedback) instead */
  feedback: boolean
  danger: boolean
}

export function bookingActions(status: BookingStatus, role: UserRole): BookingAction[] {
  const out: BookingAction[] = []
  for (const t of getAvailableTransitions(status, role)) {
    const isAdvance = ADVANCE_STEPS.includes(t.to)
    const key = t.to === 'CHANGE_REQUESTED' ? 'change-request'
      : t.from === 'CHANGE_REQUESTED' && t.to === 'BT_CONFIRMED' ? 'resubmit'
      : t.to === 'GT_REVIEW' ? 'submit-ground'
      : t.to === 'BT_CONFIRMED' ? 'confirm'
      : t.to === 'GT_VERIFIED' ? 'verify'
      : t.to === 'OPERATIONS_READY' ? 'mark-operations-ready'
      : t.to === 'CLIENT_LIVE' ? 'client-live'
      : t.to === 'IN_PROGRESS' ? 'in-progress'
      : isAdvance ? 'advance-status'
      : t.to === 'COMPLETED' ? 'feedback'
      : ''
    if (!key) continue
    const feedback = t.to === 'FEEDBACK_DONE' || t.to === 'COMPLETED'
    out.push({
      to: t.to,
      label: t.to === 'GT_VERIFIED' ? '✓ Client Confirm' : t.label,
      endpoint: feedback ? 'feedback' : key,
      body: isAdvance && !feedback ? { to: t.to } : {},
      needsNote: ['change-request', 'resubmit', 'verify'].includes(key),
      feedback,
      danger: t.to === 'CHANGE_REQUESTED',
    })
  }
  return out
}

export const CAN_CANCEL_ROLES: UserRole[] = ['BT_USER', 'TE_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export function statusLabel(s: BookingStatus): string {
  return STATUS_LABELS[s] ?? s
}
