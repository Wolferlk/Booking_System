import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getQuoteTemplate } from '@/lib/applesystem'

export const dynamic = 'force-dynamic'

/**
 * GET /api/as-bookings-v2/quote?quotation_no=..&reference_id=..
 * Returns the composed AppleSystem booking-confirmation template (parties,
 * accommodation, itinerary, inclusions/exclusions, terms, and P&L).
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const url = new URL(req.url)
  const quotationNo = url.searchParams.get('quotation_no') || ''
  const referenceId = url.searchParams.get('reference_id') || ''
  if (!quotationNo || !referenceId) {
    return buildApiError('quotation_no and reference_id are required', 400)
  }

  try {
    const quote = await getQuoteTemplate(quotationNo, referenceId)
    return buildApiSuccess({ quote })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load booking confirmation'
    return buildApiError(msg, 502)
  }
}
