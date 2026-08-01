import { NextRequest } from 'next/server'
import { authorizeRequest, type AsApiScope } from '@/lib/public-api/as-api-auth'
import { apiOk, apiFail, readJsonBody, runRoute } from '@/lib/public-api/as-http'
import {
  AsApiError,
  createQuotationBooking,
  updateQuotationBooking,
  cancelQuotationBooking,
  readIdentifier,
} from '@/lib/public-api/as-quotation-actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/public/as/v1/quotation/sync
 * Body: { action: "CREATE" | "UPDATE" | "CANCEL", …the action's own fields }
 *
 * One URL for the whole integration. AppleSystem can wire a single webhook into
 * its quotation save/cancel hooks and switch on `action`, rather than having to
 * pick an endpoint per event. The behaviour is identical to the dedicated
 * `/create`, `/update` and `/cancel` routes.
 */
const SCOPE_FOR: Record<string, AsApiScope> = {
  CREATE: 'quotation:create',
  UPDATE: 'quotation:update',
  CANCEL: 'quotation:cancel',
}

export async function POST(req: NextRequest) {
  return runRoute('quotation/sync', async (requestId) => {
    const body = await readJsonBody(req)
    const action = String(body.action ?? body.event ?? '').trim().toUpperCase()

    // Common aliases from the AS side, so a "cancelled" event still lands.
    const normalized =
      action === 'CANCELLED' || action === 'CANCELLATION' ? 'CANCEL'
      : action === 'CREATED' || action === 'NEW' ? 'CREATE'
      : action === 'UPDATED' || action === 'AMEND' || action === 'AMENDED' || action === 'REVISED' ? 'UPDATE'
      : action

    const scope = SCOPE_FOR[normalized]
    if (!scope) {
      throw new AsApiError('action must be one of CREATE, UPDATE or CANCEL', 422, 'INVALID_ACTION')
    }

    const auth = await authorizeRequest(req, scope)
    if (!auth.ok) return apiFail(auth.error, auth.status, 'UNAUTHORIZED', requestId)

    const identifier = readIdentifier(body)

    if (normalized === 'CREATE') {
      const result = await createQuotationBooking(identifier, auth.caller)
      return apiOk({ ...result }, result.already_exists ? 200 : 201, requestId)
    }

    if (normalized === 'UPDATE') {
      const result = await updateQuotationBooking(
        {
          ...identifier,
          amendment_note: body.amendment_note ? String(body.amendment_note) : null,
          force_replace_details: body.force_replace_details === true,
          create_if_missing: body.create_if_missing === true,
          fields: (body.fields as Record<string, unknown>) ?? undefined,
        },
        auth.caller,
      )
      return apiOk({ ...result }, 200, requestId)
    }

    const result = await cancelQuotationBooking(
      {
        ...identifier,
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
