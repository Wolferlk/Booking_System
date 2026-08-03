import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, readJsonBody, runRoute } from '@/lib/public-api/fh-http'
import { requireBooking, serializeBooking, updateBookingDetails } from '@/lib/public-api/fh-actions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/fh/v1/bookings/{ref}
 *
 * The whole booking as the file handler sees it — status, pax, contacts,
 * passengers, flights, hotels and the cancellation trail. `{ref}` may be the
 * booking ref, the IS number or the CNTL number.
 */
export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('bookings/get', async (requestId) => {
    await requireCaller(req, 'booking:read')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    return apiOk({ booking: serializeBooking(booking) }, 200, requestId)
  })
}

/**
 * PATCH /api/public/fh/v1/bookings/{ref}
 * Body: any of agent_email, agent_phone, agent_whatsapp, contact_email,
 *       contact_phone, contact_whatsapp, important_notes
 *
 * Updates agent + guest contact details and the important-notes block — exactly
 * the fields the portal exposes. Send `null` or `""` to clear one. Contacts may
 * also be nested under `"contacts": { … }`.
 */
export async function PATCH(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('bookings/update', async (requestId) => {
    const caller = await requireCaller(req, 'booking:write')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    const body = await readJsonBody(req)

    const { booking: updated, changed } = await updateBookingDetails(caller, booking, body)
    return apiOk(
      {
        booking: serializeBooking(updated),
        changed_fields: changed,
        message: `Updated ${changed.length} field${changed.length === 1 ? '' : 's'} on ${updated.bookingRef}`,
      },
      200,
      requestId,
    )
  })
}

/** `PUT` behaves identically — some HTTP clients cannot send PATCH. */
export const PUT = PATCH
