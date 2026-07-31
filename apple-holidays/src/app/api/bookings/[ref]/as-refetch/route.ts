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
 * POST /api/bookings/[ref]/as-refetch
 *
 * Re-pulls an ALREADY-IMPORTED booking's quote from AppleSystem and replaces its
 * itinerary with the freshly-mapped one. This exists because the import is
 * idempotent — `importMappedBooking` short-circuits on an existing `bookingRef`,
 * so a booking created before a mapper fix keeps its stale itinerary forever and
 * the agenda generated from it stays wrong.
 *
 * Deliberately narrow: ONLY `itineraryItems` are rewritten. Dates, pax, pricing
 * and accommodations are left alone — those feed the P&L and the workflow state,
 * and silently overwriting them on a live booking is not something a "refresh
 * the itinerary" action should do.
 *
 * The replaced itinerary is returned as `previous` so the caller can show what
 * changed, and the swap is written in one transaction.
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
      itineraryItems: {
        orderBy: [{ dayNo: 'asc' }, { date: 'asc' }],
        select: { dayNo: true, date: true, title: true, description: true },
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

  // 1. Resolve the ref back to its AppleSystem quote. The stored IS number wins
  //    when present; the ref itself is the fallback.
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

  // 2. Map it with the current mapper.
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

  // Refuse to wipe a good itinerary with an empty one.
  if (mapped.itineraryItems.length === 0) {
    return buildApiError('AppleSystem returned no itinerary for this booking — nothing was changed.', 422)
  }

  // Guard against refetching a different booking's quote onto this record.
  if (mapped.bookingRef !== booking.bookingRef) {
    return buildApiError(
      `AppleSystem returned quotation ${mapped.bookingRef}, which does not match this booking (${booking.bookingRef}). Nothing was changed.`,
      409,
    )
  }

  const previous = booking.itineraryItems.map((i) => ({
    dayNo: i.dayNo,
    date: new Date(i.date).toISOString().slice(0, 10),
    title: i.title,
    description: i.description,
  }))

  // 3. Swap the itinerary atomically.
  await prisma.$transaction([
    prisma.itineraryItem.deleteMany({ where: { bookingId: booking.id } }),
    prisma.itineraryItem.createMany({
      data: mapped.itineraryItems.map((i) => ({
        bookingId: booking.id,
        dayNo: i.dayNo,
        date: new Date(i.date),
        title: i.title,
        description: i.description || null,
      })),
    }),
  ])

  // 4. Audit trail. This goes to the activity log, not `StatusEvent` — the
  //    status timeline is the append-only record of workflow *transitions*, and
  //    refreshing content is not one.
  await logActivity({
    userId: session.user.id,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId: booking.id,
    details: {
      op: 'as_refetch_itinerary',
      bookingRef: booking.bookingRef,
      quotationNo: row.quotation_no,
      replaced: previous.length,
      created: mapped.itineraryItems.length,
      previous,
    },
  })

  return buildApiSuccess(
    {
      bookingRef: booking.bookingRef,
      quotationNo: row.quotation_no,
      previousCount: previous.length,
      newCount: mapped.itineraryItems.length,
      previous,
      itineraryItems: mapped.itineraryItems,
    },
    `Itinerary refetched — ${previous.length} item(s) replaced with ${mapped.itineraryItems.length}. Regenerate the agenda to apply it.`,
  )
}
