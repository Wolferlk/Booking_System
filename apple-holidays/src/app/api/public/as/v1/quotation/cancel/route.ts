import { NextRequest } from 'next/server'
import { authorizeRequest } from '@/lib/public-api/as-api-auth'
import { apiOk, apiFail, readJsonBody, runRoute } from '@/lib/public-api/as-http'
import { cancelQuotationBooking, readIdentifier } from '@/lib/public-api/as-quotation-actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/public/as/v1/quotation/cancel  (DELETE behaves identically)
 * Body: { is_number | quotation_no, reason?, cancellation_fee?, cancellation_fees?, … }
 *
 * Cancels the ops booking outright — no accounts approval step, because the
 * commercial decision was already taken in AppleSystem. Idempotent: cancelling
 * an already-cancelled booking succeeds without changing anything.
 */
export async function POST(req: NextRequest) {
  return runRoute('quotation/cancel', async (requestId) => {
    const auth = await authorizeRequest(req, 'quotation:cancel')
    if (!auth.ok) return apiFail(auth.error, auth.status, 'UNAUTHORIZED', requestId)

    const body = await readJsonBody(req)
    const result = await cancelQuotationBooking(
      {
        ...readIdentifier(body),
        reason: body.reason ? String(body.reason) : null,
        cancellation_fee: (body.cancellation_fee ?? body.cancellationFee ?? null) as number | string | null,
        cancellation_fees: body.cancellation_fees ?? body.cancellationFees,
        currency: body.currency ? String(body.currency) : null,
        suppress_email: body.suppress_email === true,
        cancelled_by: body.cancelled_by ? String(body.cancelled_by) : null,
        cancelled_by_email: body.cancelled_by_email ? String(body.cancelled_by_email) : null,
      },
      auth.caller,
    )
    return apiOk({ ...result }, 200, requestId)
  })
}

export const DELETE = POST
