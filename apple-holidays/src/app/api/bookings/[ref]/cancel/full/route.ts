import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
import { sendCancellationEmail } from '@/lib/send-cancellation-email'
import { sanitizeCancellationFees, totalCancellationFee } from '@/lib/cancellation-fees'
import {
  parseCancellationPolicy, roleInAudience, isSealed, FULL_CANCEL_MARKER,
} from '@/lib/cancellation-policy'
import type { UserRole, BookingStatus, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Full cancel — the sealed, never-recoverable cancellation.
 *
 * Two doors lead here and both end in the same place, a booking that no role
 * and no future setting can bring back:
 *
 *   A live booking      → cancelled outright and sealed in one step. This is
 *                         the only path in the system that does not queue for
 *                         accounts approval, which is why it ships switched
 *                         off, defaults to admins alone, and asks for the
 *                         reference to be typed out.
 *   An already-cancelled → the status does not move; the seal is simply added,
 *   booking               closing the recovery window early.
 *
 * The seal is an append-only `StatusEvent` marker, never a column, so it cannot
 * be lost to a later write and nothing on the booking is overwritten to set it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'cancel_' } },
    select: { key: true, value: true },
  })
  const raw: Record<string, string> = {}
  for (const r of rows) raw[r.key] = r.value
  const policy = parseCancellationPolicy(raw)

  if (!policy.fullEnabled) {
    return buildApiError('Full cancel is switched off in Settings', 403)
  }
  const role = session.user.role as UserRole
  if (!roleInAudience(role, policy.fullAudience)) {
    return buildApiError('Your role is not allowed to fully cancel a booking', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: { passengers: { where: { isLead: true }, take: 1 } },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const body = await req.json().catch(() => ({}))
  const reason = String(body?.reason ?? '').trim()
  const confirmRef = String(body?.confirmRef ?? '').trim()

  if (!reason) return buildApiError('A reason is required for a full cancellation')
  // Case-insensitive so the reference need not be retyped in the exact case,
  // but it does have to be this booking's reference and not another one.
  if (policy.fullConfirmRef && confirmRef.toUpperCase() !== booking.bookingRef.toUpperCase()) {
    return buildApiError(`Type the booking reference ${booking.bookingRef} to confirm this cannot be undone`)
  }

  const alreadyCancelled = booking.status === 'CANCELLED'
  if (!alreadyCancelled && !CANCELLABLE_STATES.includes(booking.status as BookingStatus)) {
    return buildApiError(`Cannot cancel a booking in ${booking.status.replace(/_/g, ' ')}`)
  }

  const existing = await prisma.statusEvent.findMany({
    where: { bookingId: booking.id, toState: 'CANCELLED' },
    select: { note: true },
  })
  if (isSealed(existing)) {
    return buildApiError('This booking is already sealed — the cancellation is final')
  }

  const now = new Date()
  const actorName  = session.user.name ?? session.user.email ?? 'Unknown user'
  const actorEmail = session.user.email ?? ''
  const previousStatus = booking.status as BookingStatus
  // A booking sealed while already cancelled keeps the record of who cancelled
  // it; only a live booking sealed in one step has this session as its canceller.
  const restoredFrom = (booking.cancelPrevStatus ?? previousStatus) as BookingStatus

  const note = alreadyCancelled
    ? `${FULL_CANCEL_MARKER} Cancellation sealed by ${actorName} — this booking can never be recovered. Reason: ${reason}`
    : `${FULL_CANCEL_MARKER} Full cancellation by ${actorName} — cancelled outright without the accounts queue and sealed against recovery. Reason: ${reason}`

  const feeLines = alreadyCancelled ? null : sanitizeCancellationFees(body?.fees)
  const feeTotal = feeLines ? totalCancellationFee(feeLines) : null

  const [, updated] = await prisma.$transaction([
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: previousStatus,
        toState:   'CANCELLED',
        actorId:   session.user.id,
        note,
      },
    }),
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: alreadyCancelled
        // Nothing about the existing cancellation is touched — the seal lives
        // entirely in the trail entry above.
        ? { cancelDecisionNote: booking.cancelDecisionNote }
        : {
            status: 'CANCELLED',
            cancelPrevStatus:     previousStatus,
            cancelRequestedAt:    now,
            cancelledAt:          now,
            cancelledById:        session.user.id,
            cancelledByName:      actorName,
            cancelledByEmail:     actorEmail,
            cancellationReason:   reason,
            cancellationFees:     feeLines as unknown as Prisma.InputJsonValue,
            cancellationFeeTotal: feeTotal,
            // Sealed cancellations are self-approved by design — recorded as
            // such so the accounts trail shows who stood in for the queue.
            cancelDecidedAt:      now,
            cancelDecidedByName:  actorName,
            cancelDecidedByEmail: actorEmail,
            cancelDecisionNote:   'Full cancel — sealed against recovery, accounts queue bypassed',
          },
    }),
  ])

  // Only a live booking generates a customer-facing notice here; one that was
  // already cancelled had its notice sent when accounts approved it.
  let emailFailed = false
  if (!alreadyCancelled) {
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
        previousStatus:   restoredFrom,
        cancelledByName:  actorName,
        cancelledByEmail: actorEmail,
        reason,
        cancelledAt:      now,
        approvedByName:   actorName,
        approvedByEmail:  actorEmail,
        approvedAt:       now,
        approvalNote:     'Full cancellation — this booking cannot be reinstated',
      })
      await prisma.booking.update({
        where: { id: booking.id },
        data:  { cancelMailSentAt: new Date() },
      })
    } catch (err) {
      emailFailed = true
      console.error(`[cancel-full] notice email failed for ${params.ref}:`, err)
    }
  }

  const ok = alreadyCancelled
    ? 'Cancellation sealed — this booking can no longer be recovered'
    : 'Booking fully cancelled and sealed — it cannot be recovered'
  return buildApiSuccess(
    updated,
    emailFailed ? `${ok}, but the cancellation notice could not be emailed` : ok,
  )
}
