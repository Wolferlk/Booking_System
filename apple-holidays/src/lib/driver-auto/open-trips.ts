/**
 * Driver-Auto — which trips are still open (no driver, no vendor) inside the
 * D-N window. Derived on read from bookings / agenda / assignments, never
 * stored, so the board can never disagree with the movement chart.
 *
 * The "does this need a driver" rules are the shared ones from
 * driver-requirement.ts (leisure days, hotel-only movements, Hotel Only files),
 * so a trip the SL Driver Allocation board calls complete never shows here.
 *
 * Read-only: nothing in this file writes to the database.
 */
import { prisma } from '@/lib/prisma'
import { HOTEL_ONLY_VEHICLE, bookingNeedsDriver, movementNeedsDriver } from '@/lib/driver-requirement'
import type { BookingStatus, OperationCountry, Prisma } from '@prisma/client'
import { addDays, dayDiff, localToday, ymdOf } from './server'
import { fileNumberOf, type DaCountry, type OpenTrip, type TripLeg } from './shared'

/** A booking in any of these states is not a trip anyone should drive. */
export const CLOSED_STATUSES: BookingStatus[] = [
  'DRAFT', 'CANCELLED', 'PENDING_CANCELLATION', 'AMENDED', 'COMPLETED', 'FEEDBACK_DONE',
]

/** Booking-level countries that feed a tab. SG & MY share a legacy combined value. */
function bookingCountriesFor(tab: DaCountry): OperationCountry[] {
  if (tab === 'SINGAPORE') return ['SINGAPORE', 'SINGAPORE_MALAYSIA']
  if (tab === 'MALAYSIA')  return ['MALAYSIA', 'SINGAPORE_MALAYSIA']
  return [tab]
}

/**
 * A booking stored under the combined SINGAPORE_MALAYSIA value is split by its
 * ref prefix (MY… → Malaysia), the same convention as country-detection.ts.
 */
export function tabForBooking(operationCountry: string | null, bookingRef: string): DaCountry | null {
  switch (operationCountry) {
    case 'SRILANKA':  return 'SRILANKA'
    case 'VIETNAM':   return 'VIETNAM'
    case 'SINGAPORE': return 'SINGAPORE'
    case 'MALAYSIA':  return 'MALAYSIA'
    case 'SINGAPORE_MALAYSIA': return /^MY/i.test(bookingRef.trim()) ? 'MALAYSIA' : 'SINGAPORE'
    default: return null
  }
}

/** An assignment that names any driver or vendor counts as allocated. */
type AssignmentLite = {
  driverId: string | null
  vendorId: string | null
  driverName: string | null
  vendorName: string | null
} | null

export function assignmentHasParty(a: AssignmentLite): boolean {
  return !!a && !!(a.driverId || a.vendorId || a.driverName?.trim() || a.vendorName?.trim())
}

const ITEM_SELECT = {
  id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true,
  serviceType: true, meetingTime: true, timeFrom: true, sortOrder: true,
  isLeisure: true, isHotelOnly: true,
  assignment: { select: { driverId: true, vendorId: true, driverName: true, vendorName: true } },
} satisfies Prisma.AgendaItemSelect

type ItemRow = Prisma.AgendaItemGetPayload<{ select: typeof ITEM_SELECT }>

function legOf(i: ItemRow): TripLeg {
  return {
    agendaItemId: i.id,
    date: ymdOf(i.date),
    time: i.meetingTime || i.timeFrom || null,
    location: i.location,
    from: i.fromPoint,
    to: i.toPoint,
    serviceType: i.serviceType,
    driven: movementNeedsDriver(i),
  }
}

function routeOf(leg: TripLeg): string {
  const from = leg.from?.trim() || leg.location
  const to = leg.to?.trim()
  return to && to !== from ? `${from} → ${to}` : from
}

function uniq(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const v = raw?.trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

function byLegOrder(a: ItemRow, b: ItemRow) {
  return a.date.getTime() - b.date.getTime() || a.sortOrder - b.sortOrder
}

// ── Sri Lanka: whole booking = one round trip ────────────────────────────────

const SL_BOOKING_SELECT = {
  id: true, bookingRef: true, isNumber: true, cntlNumber: true, status: true, agent: true, arrivalDate: true, departureDate: true,
  paxAdults: true, paxChildren: true, hotelOnly: true, operationCountry: true,
  passengers: { where: { isLead: true }, take: 1, select: { name: true } },
  accommodations: { orderBy: { checkIn: 'asc' }, select: { city: true } },
  slDriverAllocation: { select: { driverId: true, vendorId: true, vehicleType: true } },
  tourAgenda: { select: { items: { select: ITEM_SELECT } } },
} satisfies Prisma.BookingSelect

type SlBookingRow = Prisma.BookingGetPayload<{ select: typeof SL_BOOKING_SELECT }>

function slTripFrom(b: SlBookingRow, today: string): OpenTrip | null {
  if (b.hotelOnly) return null
  const alloc = b.slDriverAllocation
  if (alloc?.driverId || alloc?.vendorId) return null
  if (alloc?.vehicleType === HOTEL_ONLY_VEHICLE) return null

  const items = [...(b.tourAgenda?.items ?? [])].sort(byLegOrder)
  if (!bookingNeedsDriver({ hotelOnly: b.hotelOnly, vehicleType: alloc?.vehicleType, items })) return null
  // Any movement already carrying a driver means the file is being allocated on
  // the chart — offering the rest as a "round trip" would split it.
  if (items.some(i => assignmentHasParty(i.assignment))) return null

  const legs = items.map(legOf)
  const driven = legs.filter(l => l.driven)
  const start = ymdOf(b.arrivalDate)
  const end = ymdOf(b.departureDate)
  const cities = uniq([...b.accommodations.map(a => a.city), ...driven.map(l => l.location)]).slice(0, 8)
  const first = driven[0] ?? legs[0]

  return {
    key: `B:${b.id}`,
    kind: 'BOOKING',
    country: 'SRILANKA',
    bookingId: b.id,
    bookingRef: b.bookingRef,
    isNumber: b.isNumber?.trim() || null,
    fileNo: fileNumberOf(b),
    agendaItemId: null,
    startDate: start,
    endDate: end,
    days: Math.max(1, dayDiff(start, end) + 1),
    daysAway: dayDiff(today, start),
    startTime: first?.time ?? null,
    title: cities.length ? `Round trip · ${cities.slice(0, 3).join(' · ')}${cities.length > 3 ? ' …' : ''}` : 'Round trip',
    route: first ? routeOf(first) : 'Movement chart not built yet',
    cities,
    paxAdults: b.paxAdults,
    paxChildren: b.paxChildren,
    pax: b.paxAdults + b.paxChildren,
    vehicleType: alloc?.vehicleType ?? null,
    legs,
    drivenLegs: driven.length,
    noAgenda: legs.length === 0,
    agent: b.agent,
    leadGuest: b.passengers[0]?.name ?? null,
    status: b.status,
  }
}

// ── VN / SG / MY: one movement = one trip ────────────────────────────────────

const MOVEMENT_SELECT = {
  ...ITEM_SELECT,
  agenda: {
    select: {
      booking: {
        select: {
          id: true, bookingRef: true, isNumber: true, cntlNumber: true, status: true, agent: true, hotelOnly: true, operationCountry: true,
          paxAdults: true, paxChildren: true,
          passengers: { where: { isLead: true }, take: 1, select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.AgendaItemSelect

type MovementRow = Prisma.AgendaItemGetPayload<{ select: typeof MOVEMENT_SELECT }>

function movementTripFrom(i: MovementRow, today: string, tab: DaCountry): OpenTrip | null {
  const b = i.agenda.booking
  if (b.hotelOnly) return null
  if (tabForBooking(b.operationCountry, b.bookingRef) !== tab) return null
  if (assignmentHasParty(i.assignment)) return null
  if (!movementNeedsDriver(i)) return null

  const leg = legOf(i)
  return {
    key: `M:${i.id}`,
    kind: 'MOVEMENT',
    country: tab,
    bookingId: b.id,
    bookingRef: b.bookingRef,
    isNumber: b.isNumber?.trim() || null,
    fileNo: fileNumberOf(b),
    agendaItemId: i.id,
    startDate: leg.date,
    endDate: leg.date,
    days: 1,
    daysAway: dayDiff(today, leg.date),
    startTime: leg.time,
    title: i.toPoint?.trim() || i.location,
    route: routeOf(leg),
    cities: uniq([i.location]),
    paxAdults: b.paxAdults,
    paxChildren: b.paxChildren,
    pax: b.paxAdults + b.paxChildren,
    vehicleType: null,
    legs: [leg],
    drivenLegs: 1,
    noAgenda: false,
    agent: b.agent,
    leadGuest: b.passengers[0]?.name ?? null,
    status: b.status,
  }
}

function tripSort(a: OpenTrip, b: OpenTrip) {
  return a.startDate.localeCompare(b.startDate)
    || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99')
    || a.bookingRef.localeCompare(b.bookingRef)
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Open trips for one country, from today (local) to today + horizonDays. */
export async function listOpenTrips(tab: DaCountry, horizonDays: number, now = new Date()): Promise<OpenTrip[]> {
  const today = localToday(tab, now)
  const from = new Date(`${today}T00:00:00.000Z`)
  const to = new Date(`${addDays(today, horizonDays)}T23:59:59.999Z`)

  if (tab === 'SRILANKA') {
    const rows = await prisma.booking.findMany({
      where: {
        operationCountry: 'SRILANKA',
        status: { notIn: CLOSED_STATUSES },
        hotelOnly: false,
        arrivalDate: { gte: from, lte: to },
      },
      select: SL_BOOKING_SELECT,
      orderBy: { arrivalDate: 'asc' },
    })
    return rows.map(b => slTripFrom(b, today)).filter((t): t is OpenTrip => !!t).sort(tripSort)
  }

  // Entered through `bookings` (indexed on status + arrivalDate) rather than a
  // date range on `agenda_items`, which has no date index — the RDS load is
  // table scans, not missing rows, so this keeps the board off a full scan.
  const bookings = await prisma.booking.findMany({
    where: {
      operationCountry: { in: bookingCountriesFor(tab) },
      status: { notIn: CLOSED_STATUSES },
      hotelOnly: false,
      arrivalDate: { lte: to },
      departureDate: { gte: from },
    },
    select: {
      ...MOVEMENT_SELECT.agenda.select.booking.select,
      tourAgenda: {
        select: {
          items: {
            where: {
              date: { gte: from, lte: to },
              OR: [
                { assignment: { is: null } },
                { assignment: { driverId: null, vendorId: null, vendorName: null } },
              ],
            },
            select: ITEM_SELECT,
          },
        },
      },
    },
  })

  const trips: OpenTrip[] = []
  for (const b of bookings) {
    const { tourAgenda, ...booking } = b
    for (const item of tourAgenda?.items ?? []) {
      const t = movementTripFrom({ ...item, agenda: { booking } }, today, tab)
      if (t) trips.push(t)
    }
  }
  return trips.sort(tripSort)
}

/**
 * The live state of ONE trip key — used right before assigning, so a request
 * is only ever honoured against what the database says now.
 */
export async function loadTrip(key: string, now = new Date()): Promise<
  | { open: true; trip: OpenTrip }
  | { open: false; reason: 'gone' | 'allocated' | 'closed'; bookingRef?: string }
> {
  const [kind, id] = [key.slice(0, 2), key.slice(2)]
  if (!id) return { open: false, reason: 'gone' }

  if (kind === 'B:') {
    const b = await prisma.booking.findUnique({ where: { id }, select: SL_BOOKING_SELECT })
    if (!b || b.operationCountry !== 'SRILANKA') return { open: false, reason: 'gone' }
    if (CLOSED_STATUSES.includes(b.status)) return { open: false, reason: 'closed', bookingRef: b.bookingRef }
    const trip = slTripFrom(b, localToday('SRILANKA', now))
    return trip ? { open: true, trip } : { open: false, reason: 'allocated', bookingRef: b.bookingRef }
  }

  if (kind === 'M:') {
    const i = await prisma.agendaItem.findUnique({ where: { id }, select: MOVEMENT_SELECT })
    if (!i) return { open: false, reason: 'gone' }
    const b = i.agenda.booking
    if (CLOSED_STATUSES.includes(b.status)) return { open: false, reason: 'closed', bookingRef: b.bookingRef }
    const tab = tabForBooking(b.operationCountry, b.bookingRef)
    if (!tab || tab === 'SRILANKA') return { open: false, reason: 'gone', bookingRef: b.bookingRef }
    const trip = movementTripFrom(i, localToday(tab, now), tab)
    return trip ? { open: true, trip } : { open: false, reason: 'allocated', bookingRef: b.bookingRef }
  }

  return { open: false, reason: 'gone' }
}

/** The fields a driver may see before the trip is theirs — no agent, no guest. */
export function publicTrip(t: OpenTrip): OpenTrip {
  const rest: OpenTrip = { ...t }
  delete rest.agent
  delete rest.leadGuest
  delete rest.status
  delete rest.requestCount
  return rest
}
