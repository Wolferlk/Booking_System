/**
 * GET /api/public/agenda-journey/:ref?t=…
 *
 * The traveller-facing twin of the staff movement-chart map. Same derived
 * route, same process-memory cache — the only difference is the gate: no
 * session, access proven by the signed token from the shareable portal link,
 * exactly as `/api/public/journey-map/[ref]` does it.
 *
 * Read only. Nothing here writes to the booking.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { verifyPortalLinkToken } from '@/lib/portal-link'
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
  const token = req.nextUrl.searchParams.get('t') ?? ''
  if (!verifyPortalLinkToken(params.ref, token)) {
    return buildApiError('This link is invalid or has expired.', 403)
  }

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
        select: { id: true, hotel: true, city: true, checkIn: true, checkOut: true, nights: true, roomType: true, mealType: true },
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
  if (!booking) return buildApiError('We could not find this booking.', 404)

  const items = booking.tourAgenda?.items ?? []
  if (items.length === 0) return buildApiSuccess(EMPTY)

  // Guests share one cache entry with the operations page — the route is
  // identical, and the first person to open it warms it for everyone else.
  // The flights are part of the route now, so an edited sector has to
  // invalidate it — the agenda's own timestamp does not move when one changes.
  const flightKey = booking.flights.map(f => `${f.id}${f.flightNo}${f.fromApt}${f.toApt}`).join('|')
  const cacheKey = `${booking.tourAgenda?.updatedAt.toISOString()}:${items.length}:${flightKey}`
  const cached = getCachedAgendaJourney(booking.bookingRef, cacheKey)
  if (cached) return buildApiSuccess({ ...cached, cached: true })

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
    console.error('[agenda-journey:public] build failed:', e)
    return buildApiError('The map could not be built right now. Please try again shortly.', 502)
  }
}
