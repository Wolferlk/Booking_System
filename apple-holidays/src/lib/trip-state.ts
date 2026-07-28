/**
 * Post-travel trip states — the query-side twin of `getDisplayStatus()` in
 * `state-machine.ts`.
 *
 * These are NOT BookingStatus values and are never stored. They are derived
 * from (departure date, guest feedback) so the dashboard and the bookings list
 * can count and filter the same buckets the status badge shows:
 *
 *   TRIP_PENDING_REVIEW → trip is over, guest feedback form not filled yet
 *   TRIP_COMPLETED      → trip is over and reviewed (feedback filled, or COMPLETED)
 *
 * Cancellations are excluded from both: that trip never ran.
 */

import type { Prisma } from '@prisma/client'

export const TRIP_COMPLETED = 'TRIP_COMPLETED'
export const TRIP_PENDING_REVIEW = 'TRIP_PENDING_REVIEW'

export type TripState = typeof TRIP_COMPLETED | typeof TRIP_PENDING_REVIEW

export const TRIP_STATES: TripState[] = [TRIP_PENDING_REVIEW, TRIP_COMPLETED]

export const TRIP_STATE_LABELS: Record<TripState, string> = {
  [TRIP_PENDING_REVIEW]: 'Trip Completed & Pending Customer Review',
  [TRIP_COMPLETED]:      'Trip Completed',
}

export function isTripState(value: string): value is TripState {
  return (TRIP_STATES as string[]).includes(value)
}

/**
 * Prisma `where` fragment for a derived trip state.
 *
 * "Trip is over" means the whole departure day has passed — a booking
 * departing 06 Aug only qualifies from 07 Aug onwards, matching the badge.
 */
export function tripStateWhere(state: TripState, now: Date = new Date()): Prisma.BookingWhereInput {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const base: Prisma.BookingWhereInput = {
    departureDate: { lt: todayStart },
    status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION'] },
  }

  if (state === TRIP_COMPLETED) {
    return {
      ...base,
      OR: [{ guestFeedback: { isNot: null } }, { status: 'COMPLETED' }],
    }
  }

  return {
    ...base,
    guestFeedback: { is: null },
    NOT: { status: 'COMPLETED' },
  }
}
