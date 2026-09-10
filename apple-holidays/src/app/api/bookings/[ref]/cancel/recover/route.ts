import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendCancellationRecoveredEmail } from '@/lib/send-cancellation-email'
import {
  parseCancellationPolicy, evaluateRecovery, isSealed, buildRecoveryNote,
  RECOVERY_BLOCK_MESSAGES, type CancellationSnapshot,
} from '@/lib/cancellation-policy'
import { Prisma, type UserRole, type BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** The policy, read fresh on every call — a toggle flipped in Settings applies at once. */
async function loadPolicy() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'cancel_' } },
    select: { key: true, value: true },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return parseCancellationPolicy(map)
}

/**
 * Everything needed to decide whether this booking can come back, in one read.
 * The status trail carries the full-cancel seal (see lib/cancellation-policy),
 * so it is fetched alongside the booking rather than inferred from a column.
 */
async function loadContext(ref: string) {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    include: { passengers: { where: { isLead: true }, take: 1 } },
  })
  if (!booking) return null
  const events = await prisma.statusEvent.findMany({
    where: { bookingId: booking.id, toState: 'CANCELLED' },
    select: { note: true },
  })
  return { booking, sealed: isSealed(events) }
}

/**
 * Can this booking be recovered, and by me?
 *
 * The booking page asks before it draws the button, so the answer it shows and
 * the answer POST enforces come out of the same `evaluateRecovery` call and
 * cannot drift apart.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const ctx = await loadContext(params.ref)
  if (!ctx) return buildApiError('Booking not found', 404)

  const policy = await loadPolicy()
  const verdict = evaluateRecovery({
    policy,
    role: session.user.role as UserRole,
    status: ctx.booking.status,
    cancelPrevStatus: ctx.booking.cancelPrevStatus,
    cancelledAt: ctx.booking.cancelledAt,
    cancelDecidedAt: ctx.booking.cancelDecidedAt,
    cancelRequestedAt: ctx.booking.cancelRequestedAt,
    sealed: ctx.sealed,
  })

  return buildApiSuccess({
    policy,
    ...verdict,
    blockMessage: verdict.block ? RECOVERY_BLOCK_MESSAGES[verdict.block] : null,
  })
}

/**
 * Pull a cancelled booking back to the status it held before the cancellation
 * was requested.
 *
 * Nothing is deleted. The live cancellation columns are cleared so the next
 * cancellation starts from a clean slate, but the whole record they held is
 * folded into the recovery's status-trail entry first, which is append-only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const ctx = await loadContext(params.ref)
  if (!ctx) return buildApiError('Booking not found', 404)

  const policy = await loadPolicy()
  const verdict = evaluateRecovery({
    policy,
    role: session.user.role as UserRole,
    status: ctx.booking.status,
    cancelPrevStatus: ctx.booking.cancelPrevStatus,
    cancelledAt: ctx.booking.cancelledAt,
    cancelDecidedAt: ctx.booking.cancelDecidedAt,
    cancelRequestedAt: ctx.booking.cancelRequestedAt,
    sealed: ctx.sealed,
  })
  if (!verdict.allowed) {
    return buildApiError(RECOVERY_BLOCK_MESSAGES[verdict.block!], verdict.block === 'role' ? 403 : 400)
  }

  const body = await req.json().catch(() => ({}))
  const reason = String(body?.reason ?? '').trim()
  if (policy.recoveryRequireReason && !reason) {
    return buildApiError('A reason is required to recover a cancelled booking')
  }

  const { booking } = ctx
  const recoveredAt = new Date()
  const recoveredBy = session.user.name ?? session.user.email ?? 'Unknown user'

  // Everything the booking is about to stop carrying, kept verbatim.
  const snapshot: CancellationSnapshot = {
    status:               booking.status,
    restoredTo:           verdict.restoreTo,
    cancelledByName:      booking.cancelledByName,
    cancelledByEmail:     booking.cancelledByEmail,
    cancellationReason:   booking.cancellationReason,
    cancellationFees:     booking.cancellationFees ?? null,
    cancellationFeeTotal: booking.cancellationFeeTotal?.toString() ?? null,
    cancelRequestedAt:    booking.cancelRequestedAt?.toISOString() ?? null,
    cancelledAt:          booking.cancelledAt?.toISOString() ?? null,
    cancelDecidedByName:  booking.cancelDecidedByName,
    cancelDecidedAt:      booking.cancelDecidedAt?.toISOString() ?? null,
    cancelDecisionNote:   booking.cancelDecisionNote,
  }

  // The trail entry is written first: if the update below fails, the record of
  // the attempt survives; if the entry failed, no state would have changed.
  const [, updated] = await prisma.$transaction([
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'CANCELLED',
        toState:   verdict.restoreTo,
        actorId:   session.user.id,
        note:      buildRecoveryNote(reason || 'No reason given', snapshot),
      },
    }),
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: {
        status: verdict.restoreTo,
        cancelPrevStatus:     null,
        cancelRequestedAt:    null,
        cancelledAt:          null,
        cancelledById:        null,
        cancelledByName:      null,
        cancelledByEmail:     null,
        cancellationReason:   null,
        cancellationFees:     Prisma.JsonNull,
        cancellationFeeTotal: null,
        cancelDecidedAt:      null,
        cancelDecidedByName:  null,
        cancelDecidedByEmail: null,
        cancelDecisionNote:   null,
        // Cleared so a future cancellation's notice is not suppressed by the
        // stamp left behind by the one just reversed.
        cancelMailSentAt:     null,
      },
    }),
  ])

  // Mail must never undo the recovery — a failure comes back as a warning.
  let emailFailed = false
  if (policy.recoveryNotify) {
    try {
      await sendCancellationRecoveredEmail({
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
        previousStatus:   verdict.restoreTo as BookingStatus,
        cancelledByName:  snapshot.cancelledByName ?? 'Unknown user',
        cancelledByEmail: snapshot.cancelledByEmail ?? '',
        reason:           snapshot.cancellationReason ?? '—',
        cancelledAt:      booking.cancelledAt ?? recoveredAt,
        approvalNote:     reason || null,
        restoredStatus:   verdict.restoreTo,
        recoveredByName:  recoveredBy,
        recoveredAt,
      })
    } catch (err) {
      emailFailed = true
      console.error(`[cancel-recover] notification email failed for ${params.ref}:`, err)
    }
  }

  const ok = `Booking recovered — back at ${verdict.restoreTo.replace(/_/g, ' ')}`
  return buildApiSuccess(
    updated,
    emailFailed ? `${ok}, but the notification email could not be sent` : ok,
  )
}
