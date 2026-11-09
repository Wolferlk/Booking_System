import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { getQuoteTemplateRaw } from '@/lib/applesystem'
import { mapQuoteToBooking, ASMappingError } from '@/lib/as-booking-map'
import { findQuoteRow } from '@/lib/as-quote-lookup'
import { createTicketsFromQuote } from '@/lib/as-auto-tickets'
import { isB2cOriginBooking } from '@/lib/b2c-booking-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * /api/bookings/[ref]/as-tickets — tickets from the AppleSystem API.
 *
 * GET  — can this booking use it? Reads the local DB only, so opening the
 *        tickets page never calls AppleSystem.
 * POST — pull the booking's quote from AppleSystem and create a DRAFT ticket
 *        for every costing line that has none yet.
 *
 * The same code the import runs (see as-auto-tickets.ts): create-only, never
 * touches an existing ticket, attractions and other services only.
 *
 * Returns { created, skipped, notRequested }.
 */

async function loadBooking(ref: string) {
  return prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { id: true, bookingRef: true, isNumber: true, agent: true, status: true, operationCountry: true },
  })
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role, 'ticket:read')) return buildApiError('Forbidden', 403)

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const available = booking.status !== 'CANCELLED' && !(await isB2cOriginBooking(booking.id, booking.agent))
  return buildApiSuccess({ available })
}

export async function POST(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role, 'ticket:create')) return buildApiError('Forbidden', 403)

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const sessionCountry = session.user.country as OperationCountry | undefined
  if (
    sessionCountry &&
    sessionCountry !== 'ALL' &&
    !isInCountryScope(booking.operationCountry as OperationCountry, sessionCountry)
  ) {
    return buildApiError('Forbidden — this booking belongs to another country.', 403)
  }

  if (booking.status === 'CANCELLED') {
    return buildApiError('This booking is cancelled — no tickets were created.', 409)
  }
  if (await isB2cOriginBooking(booking.id, booking.agent)) {
    return buildApiError('This is an Aahaas B2C booking — it has no AppleSystem quote to create tickets from.', 409)
  }

  const lookupRef = (booking.isNumber || '').trim() || booking.bookingRef
  let row
  let quote
  try {
    row = await findQuoteRow(lookupRef)
    if (!row) return buildApiError(`No AppleSystem quotation found for ${lookupRef}. No tickets were created.`, 404)
    // The list row's `id`, not its `reference_id` — see as-quote-lookup.ts.
    quote = await getQuoteTemplateRaw(row.quotation_no, String(row.id ?? row.reference_id))
  } catch (err) {
    console.error('[as-tickets] AppleSystem read failed for', params.ref, err)
    return buildApiError(err instanceof Error ? err.message : 'Could not reach AppleSystem. No tickets were created.', 502)
  }

  let mapped
  try {
    mapped = mapQuoteToBooking(quote.data as unknown as Record<string, unknown>, {
      fallbackIsNumber: row.is_number ?? booking.bookingRef,
    })
  } catch (err) {
    if (err instanceof ASMappingError) return buildApiError(err.message, 422)
    console.error('[as-tickets] Quote mapping failed for', params.ref, err)
    return buildApiError('Could not read the AppleSystem quotation. No tickets were created.', 500)
  }

  if (mapped.bookingRef !== booking.bookingRef) {
    return buildApiError(
      `AppleSystem returned quotation ${mapped.bookingRef}, which does not match this booking (${booking.bookingRef}). No tickets were created.`,
      409,
    )
  }

  const country = (booking.operationCountry ?? mapped.operationCountry ?? 'ALL') as OperationCountry

  let sync
  try {
    sync = await createTicketsFromQuote(booking, mapped, country, quote)
  } catch (err) {
    console.error('[as-tickets] Ticket creation failed for', params.ref, err)
    const detail = err instanceof Error ? err.message.split('\n').pop()?.trim() : null
    return buildApiError(`Could not create the tickets.${detail ? ` ${detail}` : ''}`, 500)
  }

  if (!sync) return buildApiError('The AppleSystem quotation has no costing, so there is nothing to create tickets from.', 422)

  const { created, skipped, notRequested } = sync
  return buildApiSuccess(
    { created, skipped, notRequested },
    `${created} ticket${created !== 1 ? 's' : ''} created from the API, ${skipped} already existed`,
  )
}
