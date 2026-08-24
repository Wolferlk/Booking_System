/**
 * Confirm Booking Hotels — shared shapes and pure date arithmetic.
 *
 * The Reservation desk works a single day at a time: who arrives at a property
 * today, who leaves it, and who simply stays put. That is the whole model here
 * — one hotel stay measured against one calendar day.
 *
 * Split from `hotel-movements.ts` for the same reason `precheck-shared.ts` is
 * split from `hotel-precheck.ts`: that module imports Prisma, and a single
 * value import from it drags the database client into the client bundle.
 * Everything below is pure, so both sides may import it.
 */

/** Which side of the chosen day a stay falls on. */
export type MovementKind = 'CHECKIN' | 'CHECKOUT' | 'CONTINUE'

/** The filter the page sends; `ALL` is the union of the three kinds. */
export type MovementFilter = MovementKind | 'ALL'

export const MOVEMENT_FILTERS: MovementFilter[] = ['ALL', 'CHECKIN', 'CHECKOUT', 'CONTINUE']

export const MOVEMENT_LABELS: Record<MovementFilter, string> = {
  ALL:      'All movements',
  CHECKIN:  'Check-in',
  CHECKOUT: 'Check-out',
  CONTINUE: 'Continue stay',
}

/** Midnight UTC of a date — every comparison here is whole days, never hours. */
export function startOfUtcDay(d: Date | string): Date {
  const dt = typeof d === 'string' ? new Date(d) : d
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
}

/** yyyy-mm-dd in UTC. */
export function utcDateKey(d: Date | string): string {
  return startOfUtcDay(d).toISOString().slice(0, 10)
}

/**
 * Parse a yyyy-mm-dd string into midnight UTC, or null when it is not one.
 *
 * Deliberately strict: a half-typed date in the custom-date box must not be
 * read as some other day, it must be read as "no date yet".
 */
export function parseDateKey(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The day `offset` days from today, as yyyy-mm-dd UTC. */
export function dayKeyFromToday(offset: number, now: Date = new Date()): string {
  return utcDateKey(new Date(startOfUtcDay(now).getTime() + offset * 86_400_000))
}

/**
 * Classify one stay against one day.
 *
 * Check-out wins over check-in on a same-day turnaround (`checkIn === checkOut`,
 * a day-use or a data slip) because the desk's question on such a row is
 * "is the room being released today", and returns null when the day falls
 * outside the stay entirely.
 */
export function classifyMovement(
  checkIn: Date | string,
  checkOut: Date | string,
  day: Date | string,
): MovementKind | null {
  const inKey = utcDateKey(checkIn)
  const outKey = utcDateKey(checkOut)
  const dayKey = utcDateKey(day)

  if (dayKey === outKey) return 'CHECKOUT'
  if (dayKey === inKey) return 'CHECKIN'
  if (dayKey > inKey && dayKey < outKey) return 'CONTINUE'
  return null
}

/** One row of the Confirm Booking Hotels list. */
export interface HotelMovementRow {
  /** bookingRef :: normalised hotel :: check-in day — the stay's stable identity. */
  stayKey: string
  movement: MovementKind

  bookingRef: string
  isNumber: string | null
  agent: string | null
  leadGuest: string | null
  operationCountry: string | null
  bookingStatus: string

  accommodationId: string
  hotelName: string
  city: string | null
  address: string | null
  bookingContact: string | null
  ownArrangement: boolean

  checkIn: string
  checkOut: string
  nights: number
  roomType: string | null
  roomCount: number | null
  mealType: string | null
  adults: number
  children: number
  infants: number

  /** From `hotel_reservations` when the desk has raised one; null otherwise. */
  reservationStatus: string | null
  /** Reservation confirmation number, falling back to the reconfirmation one. */
  confirmationNumber: string | null
  /** True once a supplier commitment exists (CONFIRMED or AMENDED). */
  confirmed: boolean
}

export interface MovementCounts {
  ALL: number
  CHECKIN: number
  CHECKOUT: number
  CONTINUE: number
}

export function countMovements(rows: HotelMovementRow[]): MovementCounts {
  const c: MovementCounts = { ALL: rows.length, CHECKIN: 0, CHECKOUT: 0, CONTINUE: 0 }
  for (const r of rows) c[r.movement] += 1
  return c
}
