/**
 * GET /api/public/journey-map/:ref?t=…
 *
 * The traveller-facing twin of the staff journey map. Same derived route, same
 * process-memory cache — the only difference is the gate: no session, access
 * proven by the signed token from the shareable portal link, exactly as
 * `/api/public/portal/[ref]` does it.
 *
 * Read only. Nothing here writes to the booking.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { verifyPortalLinkToken } from '@/lib/portal-link'
import { buildJourney, getCachedJourney, setCachedJourney } from '@/lib/journey-map'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
      bookingRef: true, updatedAt: true, version: true,
      operationCountry: true, tourDestination: true,
      itineraryItems: {
        orderBy: { dayNo: 'asc' },
        select: { id: true, dayNo: true, date: true, title: true, description: true },
      },
      accommodations: {
        orderBy: { checkIn: 'asc' },
        select: { id: true, hotel: true, city: true, checkIn: true, checkOut: true, nights: true, roomType: true, mealType: true },
      },
    },
  })
  if (!booking) return buildApiError('We could not find this booking.', 404)

  if (booking.itineraryItems.length === 0) {
    return buildApiSuccess({ stops: [], hotels: [], countries: [], totalKm: 0, degraded: false })
  }

  // Guests share one cache entry with the operations page — the route is
  // identical, and the first person to open it warms it for everyone else.
  const cacheKey = `${booking.version}:${booking.updatedAt.toISOString()}`
  const cached = getCachedJourney(booking.bookingRef, cacheKey)
  if (cached) return buildApiSuccess({ ...cached, cached: true })

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
    console.error('[journey-map:public] build failed:', e)
    return buildApiError('The map could not be built right now. Please try again shortly.', 502)
  }
}
