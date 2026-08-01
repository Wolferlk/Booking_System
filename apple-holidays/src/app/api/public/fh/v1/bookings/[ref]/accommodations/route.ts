import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, readJsonBody, runRoute } from '@/lib/public-api/fh-http'
import {
  addAccommodations,
  requireBooking,
  serializeAccommodation,
  serializeBooking,
} from '@/lib/public-api/fh-actions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/fh/v1/bookings/{ref}/accommodations
 * Every hotel on the booking, earliest check-in first.
 */
export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('hotels/list', async (requestId) => {
    await requireCaller(req, 'booking:read')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    return apiOk(
      {
        booking_ref: booking.bookingRef,
        count: booking.accommodations.length,
        accommodations: booking.accommodations.map(serializeAccommodation),
      },
      200,
      requestId,
    )
  })
}

/**
 * POST /api/public/fh/v1/bookings/{ref}/accommodations
 *
 * Add one hotel:
 *   { "city": "Kandy", "hotel": "Earl's Regency", "check_in": "2026-09-06",
 *     "check_out": "2026-09-08", "room_type": "Deluxe Double",
 *     "meal_type": "HB", "address": "…", "contact": "+94 81 …" }
 *
 * …or several at once with `{ "accommodations": [ …, … ] }`. `nights` is
 * computed from the dates unless you send it explicitly.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('hotels/add', async (requestId) => {
    const caller = await requireCaller(req, 'hotel:write')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    const body = await readJsonBody(req)

    const list = body.accommodations ?? body.hotels
    const inputs = Array.isArray(list) ? (list as unknown[]) : [body]
    const created = await addAccommodations(caller, booking, inputs)
    const updated = await requireBooking(booking.bookingRef)

    return apiOk(
      {
        added: created.length,
        accommodations: created.map(serializeAccommodation),
        booking: serializeBooking(updated),
        message: `Added ${created.length} hotel${created.length === 1 ? '' : 's'} to ${booking.bookingRef}`,
      },
      201,
      requestId,
    )
  })
}
