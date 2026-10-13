/**
 * Driver App — "my trips", derived on read from the same rows the movement
 * chart and the SL Driver Allocation board write:
 *
 *   * `assignments.driverId`               — this driver drives that movement
 *   * `sl_driver_allocations.driverId`     — Sri Lanka: one driver for the whole
 *                                            round trip (every day of the file)
 *
 * Grouped per booking, then per day, so the app can run "start day / end day"
 * across a multi-day tour. Nothing here writes; the app's own progress lives in
 * mobile_trip_sessions / mobile_trip_days and is merged in by the routes.
 *
 * Never returns a rate, the agent or a guest's contact details — the driver
 * sees what they need to drive the day, nothing internal.
 */
import { prisma } from '@/lib/prisma'
import type { BookingStatus } from '@prisma/client'
import { fileNumberOf } from '@/lib/driver-auto/shared'

const HIDDEN_STATUSES: BookingStatus[] = ['DRAFT', 'CANCELLED', 'PENDING_CANCELLATION', 'AMENDED']

const TZ: Record<string, string> = {
  SRILANKA: 'Asia/Colombo',
  VIETNAM: 'Asia/Ho_Chi_Minh',
  SINGAPORE: 'Asia/Singapore',
  MALAYSIA: 'Asia/Kuala_Lumpur',
  SINGAPORE_MALAYSIA: 'Asia/Singapore',
}

/** Today as YYYY-MM-DD in the country's own time zone. */
export function localTodayFor(country: string | null | undefined, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ[country ?? ''] ?? 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDaysYmd(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return ymd(d)
}

export interface TripMovement {
  id: string
  time: string | null
  timeTo: string | null
  from: string | null
  to: string | null
  location: string
  details: string | null
  serviceType: string
  mealPlan: string | null
  noDriverNeeded: boolean
  mine: boolean
}

export interface TripDayPlan {
  date: string
  dayNo: number
  movements: TripMovement[]
  hotel: { name: string; city: string; address: string | null } | null
  flights: { flightNo: string; from: string; to: string; dep: string; arr: string }[]
}

export interface DriverTrip {
  bookingId: string
  bookingRef: string
  fileNo: string
  country: string | null
  status: BookingStatus
  leadGuest: string | null
  pax: { adults: number; children: number }
  startDate: string
  endDate: string
  /** 'ROUND_TRIP' = Sri Lanka allocation (one driver, whole tour); 'MOVEMENTS' = assigned legs only */
  mode: 'ROUND_TRIP' | 'MOVEMENTS'
  vehicle: string | null
  specialNotes: string | null
  days: TripDayPlan[]
}

/**
 * All trips for a driver whose dates touch [from, to]. Ordered by start date.
 */
export async function loadDriverTrips(driverId: string, from: string, to: string): Promise<DriverTrip[]> {
  const fromD = new Date(`${from}T00:00:00.000Z`)
  const toD = new Date(`${to}T23:59:59.999Z`)

  const [assigned, allocations] = await Promise.all([
    prisma.assignment.findMany({
      where: { driverId, agendaItem: { date: { gte: fromD, lte: toD } } },
      select: { agendaItemId: true, vehicleType: true, vehiclePlate: true, agendaItem: { select: { agenda: { select: { bookingId: true } } } } },
      take: 500,
    }),
    prisma.sriLankaDriverAllocation.findMany({
      where: { driverId, booking: { departureDate: { gte: fromD }, arrivalDate: { lte: toD } } },
      select: { bookingId: true, vehicleType: true },
      take: 200,
    }),
  ])

  const mineItems = new Set(assigned.map(a => a.agendaItemId))
  const vehicleByBooking = new Map<string, string | null>()
  for (const a of assigned) {
    const v = [a.vehicleType, a.vehiclePlate].filter(Boolean).join(' · ') || null
    if (!vehicleByBooking.has(a.agendaItem.agenda.bookingId)) vehicleByBooking.set(a.agendaItem.agenda.bookingId, v)
  }
  const roundTrip = new Set(allocations.map(a => a.bookingId))
  for (const a of allocations) if (!vehicleByBooking.get(a.bookingId)) vehicleByBooking.set(a.bookingId, a.vehicleType ?? null)

  const bookingIds = Array.from(new Set([...assigned.map(a => a.agendaItem.agenda.bookingId), ...Array.from(roundTrip)]))
  if (!bookingIds.length) return []

  const bookings = await prisma.booking.findMany({
    where: { id: { in: bookingIds }, status: { notIn: HIDDEN_STATUSES } },
    select: {
      id: true, bookingRef: true, isNumber: true, cntlNumber: true, status: true, operationCountry: true,
      arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true, specialOccasions: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
      accommodations: { select: { hotel: true, city: true, address: true, checkIn: true, checkOut: true, ownArrangement: true } },
      flights: { select: { flightNo: true, fromApt: true, toApt: true, depTime: true, arrTime: true, date: true } },
      tourAgenda: {
        select: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true,
              mealPlan: true, meetingTime: true, timeFrom: true, timeTo: true, serviceType: true,
              isLeisure: true, isHotelOnly: true,
            },
          },
        },
      },
    },
  })

  const trips: DriverTrip[] = bookings.map(b => {
    const isRound = roundTrip.has(b.id)
    const items = (b.tourAgenda?.items ?? []).filter(i => isRound || mineItems.has(i.id))
    const byDay = new Map<string, TripMovement[]>()
    for (const i of items) {
      const day = ymd(i.date)
      const list = byDay.get(day) ?? []
      list.push({
        id: i.id,
        time: i.meetingTime || i.timeFrom || null,
        timeTo: i.timeTo || null,
        from: i.fromPoint?.trim() || null,
        to: i.toPoint?.trim() || null,
        location: i.location,
        details: i.details,
        serviceType: i.serviceType,
        mealPlan: i.mealPlan,
        noDriverNeeded: !!(i.isLeisure || i.isHotelOnly),
        mine: isRound || mineItems.has(i.id),
      })
      byDay.set(day, list)
    }

    // A round trip with no agenda yet still has days — the stay itself.
    const start = ymd(b.arrivalDate)
    const end = ymd(b.departureDate)
    if (isRound) {
      for (let d = start; d <= end; d = addDaysYmd(d, 1)) if (!byDay.has(d)) byDay.set(d, [])
    }

    const dates = Array.from(byDay.keys()).sort()
    const days: TripDayPlan[] = dates.map((date, idx) => {
      const stay = b.accommodations.find(a => !a.ownArrangement && ymd(a.checkIn) <= date && ymd(a.checkOut) > date)
      return {
        date,
        dayNo: idx + 1,
        movements: byDay.get(date) ?? [],
        hotel: stay ? { name: stay.hotel, city: stay.city, address: stay.address } : null,
        flights: b.flights
          .filter(f => ymd(f.date) === date)
          .map(f => ({ flightNo: f.flightNo, from: f.fromApt, to: f.toApt, dep: f.depTime, arr: f.arrTime })),
      }
    })

    return {
      bookingId: b.id,
      bookingRef: b.bookingRef,
      fileNo: fileNumberOf(b),
      country: b.operationCountry ?? null,
      status: b.status,
      leadGuest: b.passengers[0]?.name ?? null,
      pax: { adults: b.paxAdults, children: b.paxChildren },
      startDate: dates[0] ?? start,
      endDate: dates[dates.length - 1] ?? end,
      mode: isRound ? 'ROUND_TRIP' : 'MOVEMENTS',
      vehicle: vehicleByBooking.get(b.id) ?? null,
      specialNotes: b.specialOccasions?.trim() || null,
      days,
    }
  })

  return trips.filter(t => t.days.length).sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/** One trip, if this driver is (still) on it. */
export async function loadDriverTrip(driverId: string, bookingRef: string): Promise<DriverTrip | null> {
  const b = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { arrivalDate: true, departureDate: true },
  })
  if (!b) return null
  const trips = await loadDriverTrips(driverId, addDaysYmd(ymd(b.arrivalDate), -1), addDaysYmd(ymd(b.departureDate), 1))
  return trips.find(t => t.bookingRef === bookingRef) ?? null
}
