/**
 * Confirm Booking Hotels — the Reservation desk's day view.
 *
 * Pre-checking asks "what is due at D-10". This asks a different question, the
 * one the desk actually opens every morning: on *this day*, at every property
 * we hold, who is checking in, who is checking out, and who is staying on.
 *
 * Reads only. Nothing in this module writes — no reservation row is created,
 * no reconfirmation is touched. The list is derived from `bookings` +
 * `accommodations` on every call and joined to whatever reservation and
 * reconfirmation records already exist.
 *
 * Server-only: importing this pulls in Prisma. The shapes and the pure day
 * arithmetic live in `hotel-movements-shared.ts` and are re-exported below, so
 * server code only ever needs this import.
 */
import type { OperationCountry, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { buildStayKey } from './precheck-shared'
import { buildReservationKey, SECURED_STATUSES } from './reservation-shared'
import { isOwnArrangement } from './own-arrangement'
import {
  classifyMovement, startOfUtcDay,
  type HotelMovementRow, type MovementFilter,
} from './hotel-movements-shared'

export * from './hotel-movements-shared'

const DAY_MS = 86_400_000

/** How far either side of today an "any date" search is allowed to reach. */
const SEARCH_WINDOW_DAYS = 400

/** Hard ceiling on rows returned, so one bad query cannot scan a year into memory. */
export const MAX_ROWS = 1000

export interface MovementFilters {
  /**
   * The day being worked, at midnight UTC. Null only in "search every date"
   * mode, which requires `search` and is bounded to ±400 days instead.
   */
  day: Date | null
  /** Restrict to these operationCountry values (null = every country). */
  countries?: string[] | null
  /** Which side of the day to keep. Default `ALL`. */
  movement?: MovementFilter
  /** Free text over IS number, booking ref, agent, guest, hotel or city. */
  search?: string | null
  /** Include stays the guest arranged themselves. Default false. */
  includeOwnArrangement?: boolean
}

type Row = Prisma.BookingGetPayload<{
  select: {
    bookingRef: true, isNumber: true, agent: true, status: true,
    operationCountry: true, paxAdults: true, paxChildren: true, paxInfants: true,
    passengers: { select: { name: true } },
    accommodations: {
      select: {
        id: true, city: true, hotel: true, checkIn: true, checkOut: true,
        nights: true, roomType: true, mealType: true, contact: true,
        address: true, ownArrangement: true,
      },
    },
  },
}>

/**
 * Build the Confirm Booking Hotels list.
 *
 * One booking can hold a dozen stays, so bookings (with their accommodations)
 * are fetched once and the reservation and reconfirmation records are stitched
 * in from two further queries rather than one round trip per stay.
 */
export async function buildHotelMovements(f: MovementFilters): Promise<HotelMovementRow[]> {
  const movement = f.movement ?? 'ALL'
  const search = f.search?.trim().toLowerCase() || null

  if (!f.day && !search) return []

  // A day view keeps every stay spanning that day; a dateless search is bounded
  // by a window instead, so "find IS-12345" never turns into a full-table scan.
  const stayWindow: Prisma.AccommodationWhereInput = f.day
    ? { checkIn: { lte: f.day }, checkOut: { gte: f.day } }
    : {
        checkIn: { lte: new Date(startOfUtcDay(new Date()).getTime() + SEARCH_WINDOW_DAYS * DAY_MS) },
        checkOut: { gte: new Date(startOfUtcDay(new Date()).getTime() - SEARCH_WINDOW_DAYS * DAY_MS) },
      }

  const where: Prisma.BookingWhereInput = {
    status: { not: 'CANCELLED' },
    accommodations: { some: stayWindow },
  }
  if (f.countries && f.countries.length > 0) {
    // Country values travel through the API layer as plain strings and are
    // validated against the caller's own scope before they get here.
    where.operationCountry = { in: f.countries as OperationCountry[] }
  }

  const bookings: Row[] = await prisma.booking.findMany({
    where,
    select: {
      bookingRef: true, isNumber: true, agent: true, status: true,
      operationCountry: true, paxAdults: true, paxChildren: true, paxInfants: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
      accommodations: {
        where: stayWindow,
        select: {
          id: true, city: true, hotel: true, checkIn: true, checkOut: true,
          nights: true, roomType: true, mealType: true, contact: true,
          address: true, ownArrangement: true,
        },
        orderBy: { checkIn: 'asc' },
      },
    },
    orderBy: { arrivalDate: 'asc' },
  })

  // First pass: keep only the stays that survive every filter, so the two
  // lookup queries below are sized to what is actually being shown.
  interface Candidate {
    b: Row
    a: Row['accommodations'][number]
    leadGuest: string | null
    movement: NonNullable<ReturnType<typeof classifyMovement>>
    own: boolean
    stayKey: string
    reservationKey: string
  }

  const candidates: Candidate[] = []

  for (const b of bookings) {
    const leadGuest = b.passengers[0]?.name ?? null

    for (const a of b.accommodations) {
      // The column is authoritative when set; most stays only carry the signal
      // as text, so fall back to the same heuristic pre-checking uses.
      const own = isOwnArrangement(a)
      if (own && !f.includeOwnArrangement) continue

      // Without a day there is nothing to classify against, so a dateless
      // search reports every matching stay as a check-in (its own start).
      const kind = f.day ? classifyMovement(a.checkIn, a.checkOut, f.day) : 'CHECKIN'
      if (!kind) continue
      if (movement !== 'ALL' && kind !== movement) continue

      if (search) {
        const hay = [b.isNumber, b.bookingRef, b.agent, leadGuest, a.hotel, a.city]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(search)) continue
      }

      candidates.push({
        b, a, leadGuest, movement: kind, own,
        stayKey: buildStayKey(b.bookingRef, a.hotel, a.checkIn),
        reservationKey: buildReservationKey(b.bookingRef, a.hotel, a.checkIn),
      })

      if (candidates.length >= MAX_ROWS) break
    }
    if (candidates.length >= MAX_ROWS) break
  }

  if (candidates.length === 0) return []

  // Reservation and reconfirmation records are supporting detail: the day's
  // arrivals and departures must still render if either table is unavailable
  // (they were added after the core schema and are absent on some estates).
  const resByKey = new Map<string, { status: string; confirmationNumber: string | null; roomCount: number | null }>()
  try {
    const rows = await prisma.hotelReservation.findMany({
      where: { reservationKey: { in: candidates.map(c => c.reservationKey) } },
      select: { reservationKey: true, status: true, confirmationNumber: true, roomCount: true },
    })
    for (const r of rows) {
      resByKey.set(r.reservationKey, {
        status: r.status,
        confirmationNumber: r.confirmationNumber,
        roomCount: r.roomCount,
      })
    }
  } catch (e) {
    console.error('[hotel-movements] reservation lookup skipped:', (e as Error).message)
  }

  const reconByKey = new Map<string, { status: string; confirmationNumber: string | null; roomCount: number | null }>()
  try {
    const rows = await prisma.hotelReconfirmation.findMany({
      where: { stayKey: { in: candidates.map(c => c.stayKey) } },
      select: { stayKey: true, status: true, confirmationNumber: true, roomCount: true },
    })
    for (const r of rows) {
      reconByKey.set(r.stayKey, {
        status: r.status,
        confirmationNumber: r.confirmationNumber,
        roomCount: r.roomCount,
      })
    }
  } catch (e) {
    console.error('[hotel-movements] reconfirmation lookup skipped:', (e as Error).message)
  }

  const secured = new Set<string>(SECURED_STATUSES)

  const out: HotelMovementRow[] = candidates.map(({ b, a, leadGuest, movement: kind, own, stayKey, reservationKey }) => {
    const res = resByKey.get(reservationKey) ?? null
    const recon = reconByKey.get(stayKey) ?? null

    return {
      stayKey,
      movement: kind,

      bookingRef: b.bookingRef,
      isNumber: b.isNumber,
      agent: b.agent,
      leadGuest,
      operationCountry: b.operationCountry,
      bookingStatus: b.status,

      accommodationId: a.id,
      hotelName: a.hotel,
      city: a.city,
      address: a.address,
      bookingContact: a.contact,
      ownArrangement: own,

      checkIn: a.checkIn.toISOString(),
      checkOut: a.checkOut.toISOString(),
      nights: a.nights || Math.max(0, Math.round((startOfUtcDay(a.checkOut).getTime() - startOfUtcDay(a.checkIn).getTime()) / DAY_MS)),
      roomType: a.roomType,
      roomCount: res?.roomCount ?? recon?.roomCount ?? null,
      mealType: a.mealType,
      adults: b.paxAdults,
      children: b.paxChildren,
      infants: b.paxInfants,

      reservationStatus: res?.status ?? null,
      confirmationNumber: res?.confirmationNumber ?? recon?.confirmationNumber ?? null,
      confirmed: res ? secured.has(res.status) : recon?.status === 'CONFIRMED',
    }
  })

  // Check-ins first (the desk clears arrivals before anything else), then
  // check-outs, then the guests already in house — alphabetical inside each.
  const rank: Record<string, number> = { CHECKIN: 0, CHECKOUT: 1, CONTINUE: 2 }
  out.sort((x, y) =>
    rank[x.movement] - rank[y.movement] ||
    x.hotelName.localeCompare(y.hotelName) ||
    x.bookingRef.localeCompare(y.bookingRef))

  return out
}
