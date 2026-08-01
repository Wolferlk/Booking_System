import { NextRequest } from 'next/server'
import { authorizeRequest } from '@/lib/public-api/as-api-auth'
import { apiOk, apiFail, readJsonBody, runRoute } from '@/lib/public-api/as-http'
import { updateQuotationBooking, readIdentifier } from '@/lib/public-api/as-quotation-actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/public/as/v1/quotation/update  (PUT and PATCH behave identically)
 * Body: { is_number | quotation_no | booking_ref, reference_id?, fields?, … }
 *
 * With `quotation_no` + `reference_id` the revised template is re-pulled from
 * AppleSystem; otherwise the supplied `fields` are patched onto the booking.
 */
export async function POST(req: NextRequest) {
  return runRoute('quotation/update', async (requestId) => {
    const auth = await authorizeRequest(req, 'quotation:update')
    if (!auth.ok) return apiFail(auth.error, auth.status, 'UNAUTHORIZED', requestId)

    const body = await readJsonBody(req)
    const result = await updateQuotationBooking(
      {
        ...readIdentifier(body),
        amendment_note: body.amendment_note ? String(body.amendment_note) : null,
        force_replace_details: body.force_replace_details === true,
        create_if_missing: body.create_if_missing === true,
        fields: (body.fields as Record<string, unknown>) ?? undefined,
      },
      auth.caller,
    )
    return apiOk({ ...result }, 200, requestId)
  })
}

export const PUT = POST
export const PATCH = POST
