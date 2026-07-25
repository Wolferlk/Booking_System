import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
import { sendCancellationApprovalEmail } from '@/lib/send-cancellation-email'
import { sanitizeCancellationFees, totalCancellationFee } from '@/lib/cancellation-fees'
import type { UserRole, BookingStatus, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Requests a cancellation. The booking is NOT cancelled here — it is held at
 * PENDING_CANCELLATION until the accounts team approves it in
 * /api/bookings/[ref]/cancel/decision. The customer-facing cancellation mail
 * only goes out on approval; this stage just alerts the accounts desk.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  // Kept in step with CAN_CANCEL_ROLES on the booking detail page.
  const role = session.user.role as UserRole
  if (!['BT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: { passengers: { where: { isLead: true }, take: 1 } },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.status === 'PENDING_CANCELLATION') {
    return buildApiError('This booking is already awaiting accounts approval to cancel')
  }
  if (!CANCELLABLE_STATES.includes(booking.status as BookingStatus)) {
    return buildApiError(`Cannot cancel booking in ${booking.status} state`)
  }

  const { reason, fees } = await req.json()
  if (!reason || !String(reason).trim()) return buildApiError('Cancellation reason is required')

  // Fees are optional. The total is always recomputed here — never trusted from the client.
  const feeLines = sanitizeCancellationFees(fees)
  const feeTotal = totalCancellationFee(feeLines)

  // Who requested it is always taken from the session, never from the request body.
  const cancelReason     = String(reason).trim()
  const cancelledByName  = session.user.name ?? session.user.email ?? 'Unknown user'
  const cancelledByEmail = session.user.email ?? ''
  const requestedAt      = new Date()
  const previousStatus   = booking.status as BookingStatus

  const [updated] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: {
        status: 'PENDING_CANCELLATION',
        cancelPrevStatus: previousStatus,
        cancelRequestedAt: requestedAt,
        cancelledAt: null,
        cancelDecidedAt: null,
        cancelDecidedByName: null,
        cancelDecidedByEmail: null,
        cancelDecisionNote: null,
        cancelMailSentAt: null,
        cancelledById: session.user.id,
        cancelledByName,
        cancelledByEmail,
        cancellationReason: cancelReason,
        cancellationFees: feeLines as unknown as Prisma.InputJsonValue,
        cancellationFeeTotal: feeTotal,
      },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: previousStatus,
        toState: 'PENDING_CANCELLATION',
        actorId: session.user.id,
        note: `Cancellation requested — awaiting accounts approval. Reason: ${cancelReason}`,
      },
    }),
  ])

  // Alert the accounts team. A mail failure must not undo the request, so it
  // comes back as a warning on the success response instead.
  let emailFailed = false
  try {
    const approvers = await prisma.user.findMany({
      where: { role: 'AC_USER', isActive: true },
      select: { email: true },
    })
    const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')

    await sendCancellationApprovalEmail(
      {
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
        cancelledAt:      requestedAt,
      },
      approvers.map(a => a.email),
      `${appUrl}/dashboard/accounts/cancellations`,
    )
  } catch (err) {
    emailFailed = true
    console.error(`[cancel] approval-request email failed for ${params.ref}:`, err)
  }

  return buildApiSuccess(
    updated,
    emailFailed
      ? 'Cancellation sent for accounts approval — but the notification email could not be sent'
      : 'Cancellation sent to the accounts team for approval',
  )
}
