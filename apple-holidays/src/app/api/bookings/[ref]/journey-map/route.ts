/**
 * GET /api/bookings/:ref/journey-map
 *
 * The mappable route behind the Journey Map panel on the booking page. Read
 * only — it selects the itinerary and accommodation rows it needs and writes
 * nothing back; the derived route lives in a process-memory cache keyed by the
 * booking's `updatedAt`, so an amendment rebuilds it and no column is stored.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { buildJourney, getCachedJourney, setCachedJourney } from '@/lib/journey-map'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: {
      id: true, bookingRef: true, updatedAt: true, version: true,
      operationCountry: true, tourDestination: true,
      itineraryItems: {
        orderBy: { dayNo: 'asc' },
        select: { id: true, dayNo: true, date: true, title: true, description: true },
      },
      accommodations: {
        orderBy: { checkIn: 'asc' },
        select: { id: true, hotel: true, city: true, checkIn: true, checkOut: true, nights: true },
      },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.itineraryItems.length === 0) {
    return buildApiSuccess({ stops: [], hotels: [], countries: [], totalKm: 0, degraded: false })
  }

  const cacheKey = `${booking.version}:${booking.updatedAt.toISOString()}`
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  if (!refresh) {
    const cached = getCachedJourney(booking.bookingRef, cacheKey)
    if (cached) return buildApiSuccess({ ...cached, cached: true })
  }

  try {
    const journey = await buildJourney({
      bookingRef: booking.bookingRef,
      operationCountry: booking.operationCountry,
      tourDestination: booking.tourDestination,
      itinerary: booking.itineraryItems,
      accommodations: booking.accommodations,
    })
    setCachedJourney(booking.bookingRef, cacheKey, journey)
    return buildApiSuccess(journey)
  } catch (e) {
    console.error('[journey-map] build failed:', e)
    return buildApiError('The journey map could not be built. Try again in a moment.', 502)
  }
}
