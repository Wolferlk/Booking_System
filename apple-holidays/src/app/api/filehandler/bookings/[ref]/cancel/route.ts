import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
import { sendCancellationApprovalEmail } from '@/lib/send-cancellation-email'
import type { BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * File-handler cancellation request. Mirrors the staff cancel flow
 * (/api/bookings/[ref]/cancel): the booking is NOT cancelled here — it moves to
 * PENDING_CANCELLATION and the accounts team is alerted to approve. The requester
 * is recorded as the file handler (cancelledByName/Email), and the action is
 * logged for the /view Live Screen alert animation.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

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

  const { reason } = await req.json().catch(() => ({}))
  if (!reason || !String(reason).trim()) return buildApiError('Cancellation reason is required')

  const cancelReason   = String(reason).trim()
  const requestedAt    = new Date()
  const previousStatus = booking.status as BookingStatus
  const requesterName  = `${handler.name} (File Handler)`

  await prisma.booking.update({
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
      cancelledById: null, // file handlers are not staff Users
      cancelledByName: requesterName,
      cancelledByEmail: handler.email,
      cancellationReason: cancelReason,
      // Stamp handler onto the booking if not already set.
      ...((!booking.fileHandler) ? { fileHandler: handler.name } : {}),
    },
  })

  await prisma.fileHandlerLog.create({
    data: {
      fileHandlerId: handler.id,
      fileHandlerName: handler.name,
      action: 'CANCEL_REQUESTED',
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      isNumber: booking.isNumber,
      cntlNumber: booking.cntlNumber,
      operationCountry: booking.operationCountry,
      details: `Requested cancellation — awaiting accounts approval. Reason: ${cancelReason}`,
    },
  })

  // Alert the accounts team. A mail failure must not undo the request.
  let emailFailed = false
  try {
    const approvers = await prisma.user.findMany({ where: { role: 'AC_USER', isActive: true }, select: { email: true } })
    const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
    await sendCancellationApprovalEmail(
      {
        bookingRef:       booking.bookingRef,
        isNumber:         booking.isNumber,
        agent:            booking.agent,
        agentBookingId:   booking.agentBookingId,
        fileHandler:      handler.name,
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
        cancelledByName:  requesterName,
        cancelledByEmail: handler.email,
        reason:           cancelReason,
        cancelledAt:      requestedAt,
      },
      approvers.map(a => a.email),
      `${appUrl}/dashboard/accounts/cancellations`,
    )
  } catch (err) {
    emailFailed = true
    console.error(`[filehandler-cancel] approval-request email failed for ${params.ref}:`, err)
  }

  return buildApiSuccess(
    { bookingRef: booking.bookingRef },
    emailFailed
      ? 'Cancellation sent for accounts approval — but the notification email could not be sent'
      : 'Cancellation request sent to the accounts team for approval',
  )
}
