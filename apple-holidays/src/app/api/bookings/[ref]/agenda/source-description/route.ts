import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { fetchQuoteForRef, ASLookupError } from '@/lib/as-quote-lookup'
import { mapQuoteToBooking } from '@/lib/as-booking-map'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Read the latest AppleSystem itinerary prose for the movement editor.
 * This endpoint is intentionally read-only: it fetches upstream data and
 * returns a preview payload; the agenda is only changed when the operator
 * presses Save changes on the chart.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role, 'agenda:edit')) return buildApiError('Forbidden', 403)

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
