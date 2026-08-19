/**
 * GET /api/bookings/:ref/agenda-journey
 *
 * The mappable route behind the Journey Map panel, built from the AI-generated
 * movement chart rather than the itinerary — see `src/lib/agenda-journey.ts`
 * for why the two differ. Read only: it selects the agenda and accommodation
 * rows it needs and writes nothing back, and the derived route lives in a
 * process-memory cache keyed by the agenda's own `updatedAt`, so re-generating
 * the chart rebuilds the map and no column is stored.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  buildAgendaJourney, getCachedAgendaJourney, setCachedAgendaJourney,
} from '@/lib/agenda-journey'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const EMPTY = {
  stops: [], hotels: [], countries: [], totalKm: 0,
  degraded: false, basis: 'agenda' as const, dayCount: 0, flights: [],
  totalRoadKm: 0, totalDriveMin: 0,
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: {
      bookingRef: true, operationCountry: true, tourDestination: true,
      tourAgenda: {
        select: {
          updatedAt: true,
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true, date: true, location: true, fromPoint: true, toPoint: true,
              details: true, serviceType: true, timeFrom: true, timeTo: true,
              meetingTime: true, mealPlan: true, isLeisure: true, sortOrder: true,
            },
          },
        },
      },
      accommodations: {
        orderBy: { checkIn: 'asc' },
        select: { id: true, hotel: true, city: true, checkIn: true, checkOut: true, nights: true },
      },
      // The movement chart books the car to the airport, never the sector in
      // between. The flight list is the only record of an internal hop, and
      // the map weaves it in — read only, see `src/lib/agenda-journey.ts`.
      flights: {
        orderBy: { date: 'asc' },
        select: {
          id: true, flightNo: true, date: true, fromApt: true,
          depTime: true, toApt: true, arrTime: true, airline: true,
        },
      },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const items = booking.tourAgenda?.items ?? []
  if (items.length === 0) return buildApiSuccess(EMPTY)

  // The item count is in the key as well as the timestamp: rows can be deleted
  // in a transaction that leaves the agenda's own `updatedAt` untouched.
  // The flights are part of the route now, so an edited sector has to
  // invalidate it — the agenda's own timestamp does not move when one changes.
  const flightKey = booking.flights.map(f => `${f.id}${f.flightNo}${f.fromApt}${f.toApt}`).join('|')
  const cacheKey = `${booking.tourAgenda?.updatedAt.toISOString()}:${items.length}:${flightKey}`
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  if (!refresh) {
    const cached = getCachedAgendaJourney(booking.bookingRef, cacheKey)
    if (cached) return buildApiSuccess({ ...cached, cached: true })
  }

  try {
    const journey = await buildAgendaJourney({
      bookingRef: booking.bookingRef,
      operationCountry: booking.operationCountry,
      tourDestination: booking.tourDestination,
      items,
      accommodations: booking.accommodations,
      flights: booking.flights,
    })
    setCachedAgendaJourney(booking.bookingRef, cacheKey, journey)
    return buildApiSuccess(journey)
  } catch (e) {
    console.error('[agenda-journey] build failed:', e)
    return buildApiError('The journey map could not be built. Try again in a moment.', 502)
  }
}
