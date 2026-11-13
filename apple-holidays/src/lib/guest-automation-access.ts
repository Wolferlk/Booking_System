/**
 * Who may switch guest automation, and the OTP target for turning it OFF.
 * Shared by /api/verification/request (issues the code) and
 * /api/bookings/[ref]/guest-automation (spends it) so both derive the same target.
 */
import { bookingTarget } from '@/lib/action-verification'
import type { GuestAutoKind } from '@/lib/guest-auto-switches'

/** Same desks that run the guest WhatsApp panel and AI calls. */
export const GUEST_AUTOMATION_ROLES: string[] = [
  'BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

export function guestAutomationKinds(raw: unknown): GuestAutoKind[] {
  const list = Array.isArray(raw) ? raw : [raw]
  const kinds = list.filter((k): k is GuestAutoKind => k === 'messages' || k === 'calls')
  return Array.from(new Set(kinds)).sort()
}

export function guestAutomationTarget(bookingRef: string, kinds: GuestAutoKind[]): string {
  return `${bookingTarget(bookingRef)}:guest-auto-off:${[...kinds].sort().join('+')}`
}
