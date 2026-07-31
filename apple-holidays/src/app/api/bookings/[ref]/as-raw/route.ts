import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { fetchQuoteForRef, ASLookupError } from '@/lib/as-quote-lookup'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/bookings/[ref]/as-raw
 *
 * Returns the untouched `POST /api/quotation/template/quote` payload for this
 * booking's IS number — the exact upstream response, with nothing mapped,
 * renamed or dropped. It backs the "Raw API Response" popup, which is how staff
 * check what AppleSystem actually sent when an imported booking looks wrong.
 *
 * Read-only: nothing is written and no local record is touched.
 *
 * The payload embeds the full P&L cost breakdown, so this is gated on
 * `pnl:read` in addition to the booking's own country scope.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'pnl:read')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { bookingRef: true, isNumber: true, operationCountry: true },
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

  const lookupRef = (booking.isNumber || '').trim() || booking.bookingRef

  try {
    const { row, quote } = await fetchQuoteForRef(lookupRef)
    return buildApiSuccess({
      isNumber: row.is_number ?? lookupRef,
      quotationNo: row.quotation_no,
      referenceId: String(row.id ?? row.reference_id),
      status: row.status,
      statusClass: row.status_class,
      endpoint: 'POST /api/quotation/template/quote',
      requestBody: {
        quotation_no: row.quotation_no,
        reference_id: String(row.id ?? row.reference_id),
      },
      raw: quote,
    })
  } catch (err) {
    if (err instanceof ASLookupError) return buildApiError(err.message, 404)
    const msg = err instanceof Error ? err.message : 'Failed to reach AppleSystem'
    return buildApiError(msg, 502)
  }
}
