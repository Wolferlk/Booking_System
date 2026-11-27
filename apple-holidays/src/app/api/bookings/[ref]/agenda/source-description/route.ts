import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { fetchQuoteForRef, ASLookupError } from '@/lib/as-quote-lookup'
import { mapQuoteToBooking } from '@/lib/as-booking-map'
import { isB2cBooking } from '@/lib/booking-source'
import { productDescriptionFor } from '@/lib/b2c-product-description'
import { loadB2cProductDescriptions } from '@/lib/b2c-product-description-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Read the latest AppleSystem itinerary prose for the movement editor.
 * This endpoint is intentionally read-only: it fetches upstream data and
 * returns a preview payload; the agenda is only changed when the operator
 * presses Save changes on the chart.
 *
 * Aahaas B2C bookings are never in AppleSystem. For them the entries are the
 * booking's own itinerary rows, each carrying its product's description exactly
 * as the Aahaas admin dashboard shows it (`tbl_lifestyle.lifestyle_description`,
 * read-only from the store). Rows with no admin text (hotels, flights, chauffeur
 * transport) keep their itinerary description.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role, 'agenda:edit')) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: {
      bookingRef: true, isNumber: true, agent: true,
      itineraryItems: { orderBy: { dayNo: 'asc' }, select: { dayNo: true, date: true, title: true, description: true } },
    },
  })
  if (booking && isB2cBooking(booking.agent)) {
    const index = await loadB2cProductDescriptions(booking)
    const items = booking.itineraryItems.map((item) => ({
      dayNo: item.dayNo,
      date: item.date.toISOString().slice(0, 10),
      title: item.title,
      description: productDescriptionFor(index, item) ?? item.description,
    }))
    if (!items.some((i) => i.description?.trim())) {
      return buildApiError('No product descriptions found for this Aahaas order.', 404)
    }
    return buildApiSuccess({
      source: index.entries.length > 0 ? 'Aahaas admin product description' : 'Booking itinerary (Aahaas store not reachable)',
      items,
    })
  }

  try {
    const { quote } = await fetchQuoteForRef(params.ref)
    const mapped = mapQuoteToBooking(quote as unknown as Record<string, unknown>, {
      fallbackIsNumber: params.ref,
    })

    return buildApiSuccess({
      source: 'AppleSystem quote template',
      items: mapped.itineraryItems.map((item) => ({
        dayNo: item.dayNo,
        date: item.date.slice(0, 10),
        title: item.title,
        description: item.description,
      })),
    })
  } catch (err) {
    if (err instanceof ASLookupError) return buildApiError(err.message, 404)
    const message = err instanceof Error ? err.message : 'Failed to fetch AppleSystem descriptions'
    return buildApiError(message, 502)
  }
}
