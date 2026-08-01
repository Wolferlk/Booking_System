import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, readJsonBody, runRoute } from '@/lib/public-api/fh-http'
import {
  addFlights,
  requireBooking,
  serializeFlight,
  serializeBooking,
} from '@/lib/public-api/fh-actions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/fh/v1/bookings/{ref}/flights
 * Every flight on the booking, earliest first.
 */
export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('flights/list', async (requestId) => {
    await requireCaller(req, 'booking:read')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    return apiOk(
      {
        booking_ref: booking.bookingRef,
        count: booking.flights.length,
        flights: booking.flights.map(serializeFlight),
      },
      200,
      requestId,
    )
  })
}

/**
 * POST /api/public/fh/v1/bookings/{ref}/flights
 *
 * Add one flight:
 *   { "flight_no": "UL309", "date": "2026-09-04", "from_airport": "CMB",
 *     "dep_time": "01:25", "to_airport": "SIN", "arr_time": "08:05",
 *     "airline": "SriLankan", "notes": "" }
 *
 * …or several at once, by sending `{ "flights": [ …, … ] }`. The batch is
 * validated in full before anything is written, so a bad segment rejects the
 * whole request rather than leaving half the itinerary in.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('flights/add', async (requestId) => {
    const caller = await requireCaller(req, 'flight:write')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    const body = await readJsonBody(req)

    const inputs = Array.isArray(body.flights) ? (body.flights as unknown[]) : [body]
    const created = await addFlights(caller, booking, inputs)
    const updated = await requireBooking(booking.bookingRef)

    return apiOk(
      {
        added: created.length,
        flights: created.map(serializeFlight),
        booking: serializeBooking(updated),
        message: `Added ${created.length} flight${created.length === 1 ? '' : 's'} to ${booking.bookingRef}`,
      },
      201,
      requestId,
    )
  })
}
