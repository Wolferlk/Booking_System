import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendCancellationEmail, sendCancellationRejectedEmail } from '@/lib/send-cancellation-email'
import type { UserRole, BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Roles that may sign off a cancellation — kept in step with the accounts UI. */
const CAN_APPROVE_CANCEL_ROLES: UserRole[] = ['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/**
 * Accounts-team decision on a PENDING_CANCELLATION booking.
 *   APPROVE → status becomes CANCELLED and the cancellation notice goes out.
 *   REJECT   → the booking returns to the status it held before the request.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!CAN_APPROVE_CANCEL_ROLES.includes(role)) {
    return buildApiError('Only the accounts team can approve a cancellation', 403)
  }

  const body = await req.json().catch(() => ({}))
  const decision = String(body?.decision ?? '').toUpperCase()
  const note = body?.note ? String(body.note).trim() : ''

  if (decision !== 'APPROVE' && decision !== 'REJECT') {
    return buildApiError('decision must be APPROVE or REJECT')
  }
  if (decision === 'REJECT' && !note) {
    return buildApiError('A note is required when rejecting a cancellation')
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: { passengers: { where: { isLead: true }, take: 1 } },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.status !== 'PENDING_CANCELLATION') {
    return buildApiError(`Booking is in ${booking.status} — there is no cancellation to approve`)
  }

  const decidedAt      = new Date()
  const decidedByName  = session.user.name ?? session.user.email ?? 'Unknown user'
  const decidedByEmail = session.user.email ?? ''
  // Pre-request status; fall back to BT_CONFIRMED if an older row never stored one.
  const restoredStatus = (booking.cancelPrevStatus ?? 'BT_CONFIRMED') as BookingStatus
  const nextStatus: BookingStatus = decision === 'APPROVE' ? 'CANCELLED' : restoredStatus

  const [updated] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: {
        status: nextStatus,
        cancelledAt: decision === 'APPROVE' ? decidedAt : null,
        cancelDecidedAt: decidedAt,
        cancelDecidedByName: decidedByName,
        cancelDecidedByEmail: decidedByEmail,
        cancelDecisionNote: note || null,
        // A rejected request leaves no cancellation trail on the booking.
        ...(decision === 'REJECT' && {
          cancelPrevStatus: null,
          cancelRequestedAt: null,
          cancelledById: null,
          cancelledByName: null,
          cancelledByEmail: null,
          cancellationReason: null,
        }),
      },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'PENDING_CANCELLATION',
        toState: nextStatus,
        actorId: session.user.id,
        note: decision === 'APPROVE'
          ? `Cancellation approved by accounts${note ? ` — ${note}` : ''}`
          : `Cancellation rejected by accounts — ${note}`,
      },
    }),
  ])

  const mailInput = {
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
    previousStatus:   restoredStatus,
    cancelledByName:  booking.cancelledByName ?? 'Unknown user',
    cancelledByEmail: booking.cancelledByEmail ?? '',
    reason:           booking.cancellationReason ?? '—',
    cancelledAt:      booking.cancelRequestedAt ?? decidedAt,
    approvedByName:   decidedByName,
    approvedByEmail:  decidedByEmail,
    approvedAt:       decidedAt,
    approvalNote:     note || null,
  }

  // Mail must never undo the decision — failures come back as a warning.
  let emailFailed = false
  try {
    if (decision === 'APPROVE') {
      await sendCancellationEmail({ ...mailInput, cancelledAt: decidedAt })
    } else {
      await sendCancellationRejectedEmail(mailInput, restoredStatus)
    }
  } catch (err) {
    emailFailed = true
    console.error(`[cancel-decision] ${decision} email failed for ${params.ref}:`, err)
  }

  const okMessage = decision === 'APPROVE'
    ? 'Cancellation confirmed — the cancellation notice has been emailed'
    : `Cancellation rejected — booking returned to ${restoredStatus.replace(/_/g, ' ')}`

  return buildApiSuccess(
    updated,
    emailFailed ? `${okMessage.split(' — ')[0]} — but the notification email could not be sent` : okMessage,
  )
}
