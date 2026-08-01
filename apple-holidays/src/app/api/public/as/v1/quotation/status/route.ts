import { NextRequest } from 'next/server'
import { authorizeRequest } from '@/lib/public-api/as-api-auth'
import { apiOk, apiFail, runRoute } from '@/lib/public-api/as-http'
import { requireBooking, serializeBooking } from '@/lib/public-api/as-quotation-actions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/as/v1/quotation/status?is_number=IS12345
 *                                       &quotation_no=QN-2026-0012
 *
 * Read-only lookup so AppleSystem can confirm what ops currently holds — the
 * booking's status, version and any recorded cancellation — before or after
 * firing a create/update/cancel.
 */
export async function GET(req: NextRequest) {
  return runRoute('quotation/status', async (requestId) => {
    const auth = await authorizeRequest(req, 'quotation:read')
    if (!auth.ok) return apiFail(auth.error, auth.status, 'UNAUTHORIZED', requestId)

    const q = req.nextUrl.searchParams
    const booking = await requireBooking({
      is_number: q.get('is_number') || q.get('isNumber'),
      quotation_no: q.get('quotation_no') || q.get('quotationNo') || q.get('ref_number'),
      booking_ref: q.get('booking_ref') || q.get('bookingRef'),
    })

    return apiOk(
      {
        found: true,
        booking: serializeBooking(booking),
        is_cancelled: booking.status === 'CANCELLED',
        message: `Booking ${booking.bookingRef} is in ${booking.status}`,
      },
      200,
      requestId,
    )
  })
}
