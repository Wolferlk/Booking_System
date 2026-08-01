import { NextRequest } from 'next/server'
import { authorizeRequest } from '@/lib/public-api/as-api-auth'
import { apiOk, apiFail, readJsonBody, runRoute } from '@/lib/public-api/as-http'
import { createQuotationBooking, readIdentifier } from '@/lib/public-api/as-quotation-actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/public/as/v1/quotation/create
 * Body: { quotation_no, reference_id, is_number? }
 *
 * Pulls the quotation from AppleSystem and creates the ops booking as a DRAFT.
 * Idempotent — re-running returns the existing booking.
 */
export async function POST(req: NextRequest) {
  return runRoute('quotation/create', async (requestId) => {
    const auth = await authorizeRequest(req, 'quotation:create')
    if (!auth.ok) return apiFail(auth.error, auth.status, 'UNAUTHORIZED', requestId)

    const body = await readJsonBody(req)
    const result = await createQuotationBooking({ ...readIdentifier(body) }, auth.caller)
    return apiOk({ ...result }, result.already_exists ? 200 : 201, requestId)
  })
}
