/**
 * Which open trips a driver or vendor sees in the app today. Pure — no database,
 * nothing stored: the same party on the same day always gets the same list, and
 * the next local day deals a new one.
 *
 *   1. Vehicle — the group size decides the vehicle, as the ground desk allocates:
 *                1–3 guests car, 4–5 flat roof, 6–8 high roof. Bigger groups go
 *                to minibuses and buses that seat them.
 *   2. Daily   — a seeded weighted draw, so each party gets a different set and
 *                trips starting soon come up more often than ones weeks out.
 *   3. Cap     — 5 for a driver, 10 for a vendor.
 */
import { createHash } from 'node:crypto'
import { VEHICLE_LABEL, vehicleKind, type VehicleKind } from '@/lib/ops-geo'

export const DAILY_TRIP_LIMIT = { DRIVER: 5, VENDOR: 10 } as const

export interface PartyVehicle { type: string | null; seats: number }

export interface VehicleFit {
  /** The class to show, e.g. "Flat Roof". null when the party has no vehicle on file. */
  vehicle: string | null
  /** Seats of the smallest of the party's vehicles that suits this group. */
  seats: number | null
}

const GROUP_BY_KIND: Partial<Record<VehicleKind, [number, number]>> = {
  car: [1, 3], suv: [1, 3], flat_roof: [4, 5], high_roof: [6, 8],
  // Stored without saying which roof, so either van group may suit it.
  van: [4, 8],
}

/** The smallest and largest group a vehicle is offered. */
function groupFor(v: PartyVehicle): [number, number] {
  const kind = vehicleKind(v.type)
  const known = GROUP_BY_KIND[kind]
  if (known) return known
  const large = kind === 'minibus' || kind === 'bus' || kind === 'coach'
  if (!large && v.seats <= 3) return [1, 3]
  if (!large && v.seats <= 5) return [4, 5]
  if (!large && v.seats <= 8) return [6, 8]
  // A third full at least, so a coach is not sent for a group a minibus can carry.
  return [Math.max(9, Math.floor(v.seats / 3)), v.seats]
}

export function vehicleName(v: PartyVehicle): string {
  const kind = vehicleKind(v.type)
  return kind === 'other' || kind === 'none' ? `${v.seats}-seater` : VEHICLE_LABEL[kind]
}

/**
 * Whether a group suits any of these vehicles. Returns null when it suits none.
 * An unrecorded pax count (0) cannot be judged, so it is not held back.
 */
export function vehicleFit(pax: number, vehicles: PartyVehicle[]): VehicleFit | null {
  const known = vehicles.filter(v => v.seats > 0).sort((a, b) => a.seats - b.seats)
  if (!known.length) return { vehicle: null, seats: null }
  const best = pax <= 0
    ? known[0]
    : known.find(v => {
        const [min, max] = groupFor(v)
        return pax >= min && pax <= max && pax <= v.seats
      })
  return best ? { vehicle: vehicleName(best), seats: best.seats } : null
}

/** Trips starting soon have the least time left to find a driver. */
function urgencyWeight(daysAway: number): number {
  if (daysAway <= 1) return 4
  if (daysAway <= 3) return 2.5
  if (daysAway <= 6) return 1.5
  return 1
}

/** A stable number in (0, 1) for this seed and trip. */
function seededUnit(seed: string, key: string): number {
  const n = createHash('sha256').update(`${seed}|${key}`).digest().readUInt32BE(0)
  return (n + 1) / 4294967297
}

/**
 * Weighted sampling without replacement (Efraimidis–Spirakis): each trip draws
 * u^(1/weight) and the highest draws win. A trip's draw does not depend on the
 * others, so when one is taken the rest keep their places and the next in line
 * moves up — the list does not reshuffle during the day.
 */
export function dailyPicks<T extends { key: string; daysAway: number }>(trips: T[], seed: string, limit: number): T[] {
  return trips
    .map(trip => ({ trip, draw: seededUnit(seed, trip.key) ** (1 / urgencyWeight(trip.daysAway)) }))
    .sort((a, b) => b.draw - a.draw)
    .slice(0, limit)
    .map(x => x.trip)
}

/** The moment the list changes: the next midnight in this time zone. */
export function nextLocalMidnight(timeZone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  const elapsed = part('hour') * 3600 + part('minute') * 60 + part('second')
  return new Date(Math.floor(now.getTime() / 1000) * 1000 + (86_400 - elapsed) * 1000)
}
