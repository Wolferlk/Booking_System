import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { mapQuoteToBooking, ASMappingError } from '@/lib/as-booking-map'
import { fetchQuoteForRef, ASLookupError } from '@/lib/as-quote-lookup'
import { logActivity, ACTION } from '@/lib/activity'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/bookings/[ref]/as-refetch-accommodations
 *
 * Same shape as `as-refetch` (itinerary) but for accommodations — re-pulls the
 * quote from AppleSystem and replaces the stored hotel list with the freshly
 * mapped one. Deliberately narrow: dates, pax, pricing and itinerary are left
 * alone.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:edit')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: {
      id: true,
      bookingRef: true,
      isNumber: true,
      operationCountry: true,
      accommodations: {
        orderBy: { checkIn: 'asc' },
        select: { city: true, hotel: true, checkIn: true, checkOut: true, nights: true, roomType: true, mealType: true, address: true, ownArrangement: true },
      },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const sessionCountry = session.user.country as OperationCountry | undefined
  if (
    sessionCountry &&
    sessionCountry !== 'ALL' &&
    !isInCountryScope(booking.operationCountry as OperationCountry, sessionCountry)
  ) {
    return buildApiError('Forbidden — this booking belongs to another country.', 403)
  }

  const lookupRef = (booking.isNumber || '').trim() || booking.bookingRef
  let quote
  let row
  try {
    ;({ quote, row } = await fetchQuoteForRef(lookupRef))
  } catch (err) {
    if (err instanceof ASLookupError) return buildApiError(err.message, 404)
    const msg = err instanceof Error ? err.message : 'Failed to reach AppleSystem'
    return buildApiError(msg, 502)
  }

  let mapped
  try {
    mapped = mapQuoteToBooking(quote as unknown as Record<string, unknown>, {
      fallbackIsNumber: row.is_number ?? booking.bookingRef,
    })
  } catch (err) {
    if (err instanceof ASMappingError) return buildApiError(err.message, 422)
    const msg = err instanceof Error ? err.message : 'Could not map the AppleSystem quotation'
    return buildApiError(msg, 500)
  }

  if (mapped.accommodations.length === 0) {
    return buildApiError('AppleSystem returned no accommodations for this booking — nothing was changed.', 422)
  }

  if (mapped.bookingRef !== booking.bookingRef) {
    return buildApiError(
      `AppleSystem returned quotation ${mapped.bookingRef}, which does not match this booking (${booking.bookingRef}). Nothing was changed.`,
      409,
    )
  }

  const previous = booking.accommodations.map((a) => ({
    city: a.city,
    hotel: a.hotel,
    checkIn: new Date(a.checkIn).toISOString().slice(0, 10),
    checkOut: new Date(a.checkOut).toISOString().slice(0, 10),
    nights: a.nights,
    roomType: a.roomType,
    mealType: a.mealType,
    ownArrangement: a.ownArrangement,
  }))

  await prisma.$transaction([
    prisma.accommodation.deleteMany({ where: { bookingId: booking.id } }),
    prisma.accommodation.createMany({
      data: mapped.accommodations.map((a) => ({
        bookingId: booking.id,
        city: a.city,
        hotel: a.hotel,
        checkIn: new Date(a.checkIn),
        checkOut: new Date(a.checkOut),
        nights: a.nights,
        roomType: a.roomType || null,
        mealType: a.mealType || null,
        address: a.address || null,
        ownArrangement: a.ownArrangement,
      })),
    }),
  ])

  await logActivity({
    userId: session.user.id,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId: booking.id,
    details: {
      op: 'as_refetch_accommodations',
      bookingRef: booking.bookingRef,
      quotationNo: row.quotation_no,
      replaced: previous.length,
      created: mapped.accommodations.length,
      previous,
    },
  })

  return buildApiSuccess(
    {
      bookingRef: booking.bookingRef,
      quotationNo: row.quotation_no,
      previousCount: previous.length,
      newCount: mapped.accommodations.length,
      previous,
      accommodations: mapped.accommodations,
    },
    `Accommodations refetched — ${previous.length} item(s) replaced with ${mapped.accommodations.length}.`,
  )
}
