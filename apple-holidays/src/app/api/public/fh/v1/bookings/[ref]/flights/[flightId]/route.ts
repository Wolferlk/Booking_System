import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, readJsonBody, runRoute } from '@/lib/public-api/fh-http'
import { deleteFlight, requireBooking, serializeFlight, updateFlight } from '@/lib/public-api/fh-actions'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/public/fh/v1/bookings/{ref}/flights/{flightId}
 *
 * Replaces the flight. The body is the same shape as `POST /flights`, and the
 * same required fields apply — this is a full replace, not a partial patch.
 */
export async function PUT(req: NextRequest, { params }: { params: { ref: string; flightId: string } }) {
  return runRoute('flights/update', async (requestId) => {
    const caller = await requireCaller(req, 'flight:write')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    const body = await readJsonBody(req)

    const flight = await updateFlight(caller, booking, params.flightId, body)
    return apiOk(
      { flight: serializeFlight(flight), message: `Flight ${flight.flightNo} updated` },
      200,
      requestId,
    )
  })
}

/** `PATCH` is accepted as an alias — the semantics are still full replace. */
export const PATCH = PUT

/**
 * DELETE /api/public/fh/v1/bookings/{ref}/flights/{flightId}
 * Removes the flight from the booking.
 */
export async function DELETE(req: NextRequest, { params }: { params: { ref: string; flightId: string } }) {
  return runRoute('flights/delete', async (requestId) => {
    const caller = await requireCaller(req, 'flight:write')
    const booking = await requireBooking(decodeURIComponent(params.ref))

    const removed = await deleteFlight(caller, booking, params.flightId)
    return apiOk(
      { deleted: true, flight: serializeFlight(removed), message: `Flight ${removed.flightNo} removed` },
      200,
      requestId,
    )
  })
}
