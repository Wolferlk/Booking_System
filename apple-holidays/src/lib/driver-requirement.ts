/**
 * Does this movement — and this booking — need a driver?
 *
 * Two things excuse a movement from needing one:
 *
 *  • **Leisure day** (`isLeisure`) — a free / at-leisure day, see
 *    [leisure-day.ts](./leisure-day.ts).
 *  • **Hotel only** (`isHotelOnly`) — accommodation only, or the guest arranges
 *    their own transport. It may still be a busy day; we simply do not drive it.
 *
 * The booking-level equivalent is the `hotel_only` vehicle type on
 * `SriLankaDriverAllocation`: a whole file that carries no transport.
 *
 * The Sri Lanka Driver Allocation board and the Movement Chart must agree on
 * this, which is the whole reason the rules live here rather than in either
 * page: a file whose every movement is leisure or hotel-only is **allocated**,
 * not pending, and the chart hides its Assign Driver controls for exactly the
 * same rows.
 */

import { resolveIsLeisure, type LeisureCandidate } from './leisure-day'

/** The booking-level vehicle type meaning "no transport on this file at all". */
export const HOTEL_ONLY_VEHICLE = 'hotel_only'

export type DriverRequirementItem = LeisureCandidate & {
  isLeisure?: boolean | null
  isHotelOnly?: boolean | null
}

/**
 * Hotel-only is an explicit operator decision only — unlike leisure days there
 * is no text detection to fall back on, so NULL simply means "no".
 */
export function resolveIsHotelOnly(item: DriverRequirementItem): boolean {
  return item.isHotelOnly === true
}

/** True when a driver still has to be allocated to this movement. */
export function movementNeedsDriver(item: DriverRequirementItem): boolean {
  return !resolveIsHotelOnly(item) && !resolveIsLeisure(item)
}

/**
 * True when the file as a whole still needs a driver.
 *
 * `false` — and so "allocation complete" on the board — when any of three things
 * says there is nothing to drive:
 *
 *  1. **The booking is Hotel Only** (`hotelOnly`, the booking-level flag from
 *     [hotel-only.ts](./hotel-only.ts)). This outranks everything else: the file
 *     was sold as accommodation and carries no transport at all, so it is
 *     complete even with no agenda and no allocation row — which is exactly the
 *     state these bookings sit in, since no movement chart is ever built for
 *     them. Without this the board would show every Hotel Only file as pending
 *     forever, waiting on a driver nobody will ever assign.
 *  2. The allocation's vehicle type is Hotel Only — the older, allocation-level
 *     way of saying the same thing, kept for files marked before the flag
 *     existed and for a normal tour that happens to carry no transport.
 *  3. It has movements and not one of them needs a driver.
 *
 * An agenda that has not been built yet still counts as needing a driver *for a
 * normal booking*: nothing has been decided there, so it must not read as done.
 */
export function bookingNeedsDriver(args: {
  /** The booking-level Hotel Only flag. */
  hotelOnly?: boolean | null
  vehicleType?: string | null
  items: DriverRequirementItem[]
}): boolean {
  if (args.hotelOnly === true) return false
  if (args.vehicleType === HOTEL_ONLY_VEHICLE) return false
  if (args.items.length === 0) return true
  return args.items.some(movementNeedsDriver)
}
