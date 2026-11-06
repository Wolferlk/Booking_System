/**
 * Which open trips a driver or vendor sees in the app today. Pure — no database,
 * nothing stored: the same party on the same day always gets the same list, and
 * the next local day deals a new one.
 *
 *   1. Seats   — a trip is offered only to vehicles of a sensible size for its
 *                group: it has to fit, and it must not leave the vehicle mostly
 *                empty (a couple is not a job for a 40-seat coach).
 *   2. Daily   — a seeded weighted draw, so each party gets a different set and
 *                trips starting soon come up more often than ones weeks out.
 *   3. Cap     — 5 for a driver, 10 for a vendor.
 *
 * Seats here mean guests, as the app's vehicle form sets them (car 3, flat-roof
 * van 6, high-roof van 9, minibus 15, coach 25–40).
 */
import { createHash } from 'node:crypto'

export const DAILY_TRIP_LIMIT = { DRIVER: 5, VENDOR: 10 } as const

export type SeatMatch = 'PERFECT' | 'GOOD'

export interface SeatFit {
  /** null when the party has no vehicle on file, so nothing could be compared. */
  match: SeatMatch | null
  /** The smallest of the party's vehicles that suits this group. */
  seats: number | null
}

/** Smallest group a vehicle of this size is offered: a third full, rounded down. */
export function minPaxFor(seats: number): number {
  return Math.max(1, Math.floor(seats / 3))
}

/**
 * Whether a group suits any of these vehicles. Returns null when it suits none.
 * An unrecorded pax count (0) cannot be judged, so it is not held back.
 */
export function seatFit(pax: number, vehicleSeats: number[]): SeatFit | null {
  const sizes = vehicleSeats.filter(s => s > 0).sort((a, b) => a - b)
  if (!sizes.length) return { match: null, seats: null }
  if (pax <= 0) return { match: 'GOOD', seats: sizes[0] }
  const seats = sizes.find(s => pax <= s && pax >= minPaxFor(s))
  if (seats === undefined) return null
  return { match: pax * 2 > seats ? 'PERFECT' : 'GOOD', seats }
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
export function dailyPicks<T extends { key: string; daysAway: number; match: SeatMatch | null }>(trips: T[], seed: string, limit: number): T[] {
  return trips
    .map(trip => {
      const weight = urgencyWeight(trip.daysAway) * (trip.match === 'PERFECT' ? 1.5 : 1)
      return { trip, draw: seededUnit(seed, trip.key) ** (1 / weight) }
    })
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
