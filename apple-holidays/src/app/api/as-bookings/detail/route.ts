import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getBookingPnl } from '@/lib/applesystem'

export const dynamic = 'force-dynamic'

/**
 * GET /api/as-bookings/detail?reference_id=..&quotation_no=..&currency=USD
 * Returns the AppleSystem P&L / cost breakdown for one booking.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const url = new URL(req.url)
  const referenceId = url.searchParams.get('reference_id') || ''
  const quotationNo = url.searchParams.get('quotation_no') || referenceId
  const currency = url.searchParams.get('currency') || 'USD'

  if (!referenceId) return buildApiError('reference_id is required', 400)

  try {
    const data = await getBookingPnl(referenceId, quotationNo, currency)
    return buildApiSuccess({ detail: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load booking detail'
    return buildApiError(msg, 502)
  }
}
