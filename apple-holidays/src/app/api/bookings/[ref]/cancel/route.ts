import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
import { sendCancellationEmail } from '@/lib/send-cancellation-email'
import type { UserRole, BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['BT_USER', 'SUPER_ADMIN', 'TE_USER'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: { passengers: { where: { isLead: true }, take: 1 } },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  if (!CANCELLABLE_STATES.includes(booking.status as BookingStatus)) {
    return buildApiError(`Cannot cancel booking in ${booking.status} state`)
  }

  const { reason } = await req.json()
  if (!reason || !String(reason).trim()) return buildApiError('Cancellation reason is required')

  // Who cancelled is always taken from the session, never from the request body.
  const cancelReason     = String(reason).trim()
  const cancelledByName  = session.user.name ?? session.user.email ?? 'Unknown user'
  const cancelledByEmail = session.user.email ?? ''
  const cancelledAt      = new Date()
  const previousStatus   = booking.status

  const [updated] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: {
        status: 'CANCELLED',
        cancelledAt,
        cancelledById: session.user.id,
        cancelledByName,
        cancelledByEmail,
        cancellationReason: cancelReason,
      },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: previousStatus,
        toState: 'CANCELLED',
        actorId: session.user.id,
        note: cancelReason,
      },
    }),
  ])

  // Notify the canceller + the operations desk. A mail failure must not undo the
  // cancellation, so it comes back as a warning on the success response instead.
  let emailFailed = false
  try {
    await sendCancellationEmail({
      bookingRef:       booking.bookingRef,
      isNumber:         booking.isNumber,
      agent:            booking.agent,
      agentBookingId:   booking.agentBookingId,
      fileHandler:      booking.fileHandler,
      leadPassenger:    booking.passengers[0]?.name ?? null,
      arrivalDate:      booking.arrivalDate,
      departureDate:    booking.departureDate,
      paxAdults:        booking.paxAdults,
      paxChildren:      booking.paxChildren,
      paxInfants:       booking.paxInfants,
      quotedTotal:      booking.quotedTotal ? booking.quotedTotal.toString() : null,
      currency:         booking.currency,
      operationCountry: booking.operationCountry,
      previousStatus,
      cancelledByName,
      cancelledByEmail,
      reason:           cancelReason,
      cancelledAt,
    })
  } catch (err) {
    emailFailed = true
    console.error(`[cancel] notification email failed for ${params.ref}:`, err)
  }

  return buildApiSuccess(
    updated,
    emailFailed
      ? 'Booking cancelled — but the notification email could not be sent'
      : 'Booking cancelled and the team has been notified',
  )
}
