import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, getCancellationDeadline } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { getQuoteTemplate } from '@/lib/applesystem'
import { mapQuoteToBooking, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, AlreadyImportedError } from '@/lib/as-booking-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/as-bookings-v2/create
 * Body: { quotation_no: string, reference_id: string }
 *
 * Fetches the AppleSystem quote template, maps it to a local Booking, and
 * persists it (with passengers, accommodations, itinerary and emergency
 * contacts) as a DRAFT. Idempotent: if a booking with the same ref already
 * exists it is returned as-is rather than duplicated — safe to re-run.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  let body: { quotation_no?: string; reference_id?: string }
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const quotationNo = String(body.quotation_no ?? '').trim()
  const referenceId = String(body.reference_id ?? '').trim()
  if (!quotationNo || !referenceId) {
    return buildApiError('quotation_no and reference_id are required', 400)
  }

  // 1. Fetch the composed quote from AppleSystem.
  let quote: Record<string, unknown>
  try {
    quote = (await getQuoteTemplate(quotationNo, referenceId)) as unknown as Record<string, unknown>
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load booking from AppleSystem'
    return buildApiError(msg, 502)
  }

  // 2. Map to our booking shape.
  let mapped
  try {
    mapped = mapQuoteToBooking(quote)
  } catch (err) {
    if (err instanceof ASMappingError) return buildApiError(err.message, 422)
    const msg = err instanceof Error ? err.message : 'Could not map the AppleSystem quotation'
    return buildApiError(msg, 500)
  }

  // 3. Resolve the operation country, honouring the caller's country scope.
  const sessionCountry = session.user.country as OperationCountry | undefined
  const operationCountry =
    mapped.operationCountry ??
    (sessionCountry && sessionCountry !== 'ALL' ? sessionCountry : null)
  if (!operationCountry) {
    return buildApiError('Could not determine the destination country from the IS number.', 422)
  }
  if (sessionCountry && sessionCountry !== 'ALL' && !isInCountryScope(operationCountry, sessionCountry)) {
    return buildApiError('Forbidden — this booking belongs to another country.', 403)
  }

  // 4. Persist (idempotent).
  try {
    const { booking, alreadyExists } = await importMappedBooking(mapped, operationCountry, {
      createdById: session.user.id,
      cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
    })
    return buildApiSuccess(
      { bookingRef: booking.bookingRef, bookingId: booking.id, alreadyExists },
      alreadyExists
        ? `Booking ${booking.bookingRef} is already in the system.`
        : `Booking ${booking.bookingRef} imported successfully.`,
    )
  } catch (err) {
    if (err instanceof AlreadyImportedError) {
      return buildApiSuccess(
        { bookingRef: err.bookingRef, bookingId: err.bookingId, alreadyExists: true },
        `Booking ${err.bookingRef} is already in the system.`,
      )
    }
    console.error('[POST /api/as-bookings-v2/create]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Failed to import booking: ${msg}`, 500)
  }
}
