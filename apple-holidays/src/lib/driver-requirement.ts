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
 * `false` — and so "allocation complete" on the board — when the booking's
 * vehicle type is Hotel Only, or when it has movements and not one of them
 * needs a driver. An agenda that has not been built yet (no items) still counts
 * as needing a driver: nothing has been decided, so it must not read as done.
 */
export function bookingNeedsDriver(args: {
  vehicleType?: string | null
  items: DriverRequirementItem[]
}): boolean {
  if (args.vehicleType === HOTEL_ONLY_VEHICLE) return false
  if (args.items.length === 0) return true
  return args.items.some(movementNeedsDriver)
}
