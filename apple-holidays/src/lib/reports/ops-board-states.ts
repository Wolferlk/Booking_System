/**
 * The board's two derived check states, shared by the dashboard and the mail.
 *
 * Lived in `ops-board-parts.tsx` until the daily report started printing the
 * same cards; that file is a client component, so the rules moved here and are
 * re-exported from it. One definition means a booking can never read amber on
 * the board and green in the morning mail.
 */
import type { ReadinessState } from '@/lib/booking-readiness'
import type { OpsDayRow } from './ops-day-data'

/**
 * Reconfirmation is two independent signals and the board treats either one as
 * enough — a guest who has confirmed in writing does not also need a call, and a
 * completed pre-tour call reconfirms a booking whose status has not caught up.
 * Both signals in is the only fully-green state.
 */
export function reconfirmState(r: Pick<OpsDayRow, 'hotelOnly' | 'clientConfirmed' | 'preTourCall'>): ReadinessState {
  // Hotel Only has no tour to run the guest through, so neither signal is ever
  // coming. N/A, not pending — the desk must not be sent chasing it.
  if (r.hotelOnly) return 'NA'
  if (r.clientConfirmed && r.preTourCall) return 'DONE'
  if (r.clientConfirmed || r.preTourCall) return 'PARTIAL'
  return 'PENDING'
}

export function callState(r: Pick<OpsDayRow, 'hotelOnly' | 'call'>): ReadinessState {
  // No call is ever placed for a room-only file, so permission is moot.
  if (r.hotelOnly) return 'NA'
  switch (r.call.approval) {
    case 'approved':      return 'DONE'
    case 'pending':       return 'PARTIAL'
    case 'not_requested': return 'PENDING'
    default:              return 'NA'
  }
}
