/**
 * What makes a vehicle record complete, for everyone who adds one: a driver
 * registering (app or web) and a vendor building a fleet (app or web). The guest
 * ranges are also what the app's Get trips matches on (mobile/trip-picks.ts), so
 * a vehicle is always saved with a pax count that can win it the right trips.
 *
 * No server imports: the web forms use this too. The driver app keeps its own
 * copy of the ranges in src/lib/vendor.ts — it builds separately from this repo.
 */
import { vehicleKind, type VehicleKind } from '@/lib/ops-geo'

export const VEHICLE_TYPES = ['car', 'flatroof-van', 'highroof-van', 'van', 'minibus', 'bus-medium', 'bus-high', 'motorbike', 'other']

export const MAX_PAX = 80

const GUESTS_BY_KIND: Partial<Record<VehicleKind, [number, number]>> = {
  car: [1, 3], suv: [1, 3], flat_roof: [4, 5], high_roof: [6, 8],
  // Stored without saying which roof, so either van group may suit it.
  van: [4, 8],
  minibus: [9, MAX_PAX], bus: [9, MAX_PAX], coach: [9, MAX_PAX],
}

/** Guests this type of vehicle carries; null when the type says nothing about it. */
export function guestRange(type: string | null | undefined): [number, number] | null {
  if (type === 'motorbike') return [1, 1]
  return GUESTS_BY_KIND[vehicleKind(type)] ?? null
}

/** "1–3", for labels and messages. */
export function guestRangeLabel(type: string | null | undefined): string {
  const [min, max] = guestRange(type) ?? [1, MAX_PAX]
  return min === max ? String(min) : `${min}–${max}`
}

const blank = (v: unknown) => !String(v ?? '').trim()

/**
 * What is wrong with these details, or null. Adding a vehicle needs them all.
 * With `before`, only what was sent is checked, and the pax range only when the
 * type or pax count changes: vehicles saved before this rule (a flat roof with 6)
 * can still be edited without being forced to a new number.
 */
export function vehicleProblem(
  v: { type?: unknown; brand?: unknown; model?: unknown; capacity?: unknown },
  before?: { type: string; capacity: number } | null,
): string | null {
  const type = v.type === undefined && before ? before.type : String(v.type ?? '')
  const typeChanged = !before || type !== before.type
  if (typeChanged && !VEHICLE_TYPES.includes(type)) return 'Choose the vehicle type.'
  if ((!before || v.brand !== undefined) && blank(v.brand)) return 'Type the vehicle brand, like Toyota.'
  if ((!before || v.model !== undefined) && blank(v.model)) return 'Type the vehicle model, like KDH.'

  if (before && v.capacity === undefined && !typeChanged) return null
  const pax = v.capacity === undefined && before ? before.capacity : Number(blank(v.capacity) ? NaN : v.capacity)
  if (!Number.isInteger(pax) || pax < 1) return 'Enter the pax count: how many guests this vehicle takes.'
  if (!typeChanged && pax === before?.capacity) return null
  const [min, max] = guestRange(type) ?? [1, MAX_PAX]
  return pax < min || pax > max ? `Pax count for this vehicle type must be ${guestRangeLabel(type)}.` : null
}
