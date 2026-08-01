import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, readJsonBody, runRoute, str } from '@/lib/public-api/fh-http'
import { requireBooking, requestCancellation, serializeBooking } from '@/lib/public-api/fh-actions'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
import type { BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/public/fh/v1/bookings/{ref}/cancel
 *
 * Where the cancellation stands: whether one can be raised, whether one is
 * already awaiting the accounts team, and the fees recorded so far. Use it to
 * grey out a "Cancel" button before the user presses it.
 */
export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('cancel/status', async (requestId) => {
    await requireCaller(req, 'booking:read')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    const pending = booking.status === 'PENDING_CANCELLATION'

    return apiOk(
      {
        booking_ref: booking.bookingRef,
        status: booking.status,
        pending_approval: pending,
        cancellable: !pending && CANCELLABLE_STATES.includes(booking.status as BookingStatus),
        cancellation: serializeBooking(booking).cancellation,
      },
      200,
      requestId,
    )
  })
}

/**
 * POST /api/public/fh/v1/bookings/{ref}/cancel
 * Body: { "reason": "Guest cancelled the trip",
 *         "fees": [ { "note": "Hotel one-night penalty", "amount": 120 } ] }
 *
 * Raises a cancellation **request**. Nothing is cancelled outright: the booking
 * moves to `PENDING_CANCELLATION` and the accounts team is emailed to approve —
 * identical to pressing Cancel in the portal. `fees` is optional and its total
 * is always recomputed server-side, never trusted from the caller.
 *
 * A failed notification email does not undo the request; watch `email_sent`.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('cancel/request', async (requestId) => {
    const caller = await requireCaller(req, 'booking:cancel')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    const body = await readJsonBody(req)

    const reason = str(body, 'reason', 'cancellation_reason', 'note')
    const fees = body.fees ?? body.cancellation_fees ?? body.cancellationFees

    const result = await requestCancellation(caller, booking, { reason, fees })

    return apiOk(
      {
        booking: serializeBooking(result.booking),
        status: result.booking.status,
        pending_approval: true,
        cancellation_fee_total: result.fee_total,
        email_sent: result.email_sent,
        message: result.email_sent
          ? 'Cancellation request sent to the accounts team for approval'
          : 'Cancellation recorded — but the notification email could not be sent',
      },
      202,
      requestId,
    )
  })
}

/** `DELETE` is accepted as an alias for callers that model this as a delete. */
export const DELETE = POST
