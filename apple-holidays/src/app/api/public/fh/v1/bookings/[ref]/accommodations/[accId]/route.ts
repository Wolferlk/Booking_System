import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, readJsonBody, runRoute } from '@/lib/public-api/fh-http'
import {
  deleteAccommodation,
  requireBooking,
  serializeAccommodation,
  updateAccommodation,
} from '@/lib/public-api/fh-actions'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/public/fh/v1/bookings/{ref}/accommodations/{accId}
 *
 * Replaces the hotel. Same body shape and required fields as `POST` — a full
 * replace, not a partial patch.
 */
export async function PUT(req: NextRequest, { params }: { params: { ref: string; accId: string } }) {
  return runRoute('hotels/update', async (requestId) => {
    const caller = await requireCaller(req, 'hotel:write')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    const body = await readJsonBody(req)

    const acc = await updateAccommodation(caller, booking, params.accId, body)
    return apiOk(
      { accommodation: serializeAccommodation(acc), message: `${acc.hotel} updated` },
      200,
      requestId,
    )
  })
}

/** `PATCH` is accepted as an alias — the semantics are still full replace. */
export const PATCH = PUT

/**
 * DELETE /api/public/fh/v1/bookings/{ref}/accommodations/{accId}
 * Removes the hotel from the booking.
 */
export async function DELETE(req: NextRequest, { params }: { params: { ref: string; accId: string } }) {
  return runRoute('hotels/delete', async (requestId) => {
    const caller = await requireCaller(req, 'hotel:write')
    const booking = await requireBooking(decodeURIComponent(params.ref))

    const removed = await deleteAccommodation(caller, booking, params.accId)
    return apiOk(
      { deleted: true, accommodation: serializeAccommodation(removed), message: `${removed.hotel} removed` },
      200,
      requestId,
    )
  })
}
