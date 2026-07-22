/**
 * Backend watcher for cancellations approved outside this app.
 *
 * The Apple Accounts system (invoice-processor) owns the approve/reject screen
 * and flips `Booking.status` straight in the database. Nothing in that path can
 * send mail from here, so this watcher picks up the transition and sends the
 * cancellation notice — the same mail the in-app decision route sends.
 *
 * A booking qualifies when it went through the approval flow
 * (`cancelRequestedAt` is set), has landed on CANCELLED, and has not had its
 * mail sent yet (`cancelMailSentAt` is null).
 *
 * Exactly-once: the row is claimed with a conditional updateMany
 * (`cancelMailSentAt: null` → now) before the mail is sent, so two app
 * instances running the scheduler can never both send. If the send fails the
 * claim is released and the next tick retries.
 */
import { prisma } from './prisma'
import { sendCancellationEmail } from './send-cancellation-email'

/** Most bookings handled per tick — keeps a backlog from blocking the loop. */
const BATCH_SIZE = 25

/**
 * How far back the watcher will look. A cancellation older than this is left
 * alone rather than surprising everyone with a very late notice (e.g. after a
 * long outage or a bulk data fix).
 */
const MAX_AGE_DAYS = 7

export interface CancellationMailWatchResult {
  sent: number
  failed: number
  skipped: number
}

export async function runCancellationMailWatch(): Promise<CancellationMailWatchResult> {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400000)

  const pending = await prisma.booking.findMany({
    where: {
      status: 'CANCELLED',
      cancelRequestedAt: { not: null },
      cancelMailSentAt: null,
      OR: [
        { cancelledAt: { gte: cutoff } },
        { cancelledAt: null, cancelRequestedAt: { gte: cutoff } },
      ],
    },
    orderBy: { cancelledAt: 'asc' },
    take: BATCH_SIZE,
    include: { passengers: { where: { isLead: true }, take: 1 } },
  })

  const result: CancellationMailWatchResult = { sent: 0, failed: 0, skipped: 0 }

  for (const b of pending) {
    // Claim the row first — only the instance that wins this update sends.
    const claim = await prisma.booking.updateMany({
      where: { id: b.id, cancelMailSentAt: null },
      data:  { cancelMailSentAt: new Date() },
    })
    if (claim.count === 0) {
      result.skipped++
      continue
    }

    try {
      await sendCancellationEmail({
        bookingRef:       b.bookingRef,
        isNumber:         b.isNumber,
        agent:            b.agent,
        agentBookingId:   b.agentBookingId,
        fileHandler:      b.fileHandler,
        leadPassenger:    b.passengers[0]?.name ?? null,
        arrivalDate:      b.arrivalDate,
        departureDate:    b.departureDate,
        paxAdults:        b.paxAdults,
        paxChildren:      b.paxChildren,
        paxInfants:       b.paxInfants,
        quotedTotal:      b.quotedTotal ? b.quotedTotal.toString() : null,
        currency:         b.currency,
        operationCountry: b.operationCountry,
        previousStatus:   b.cancelPrevStatus ?? 'BT_CONFIRMED',
        cancelledByName:  b.cancelledByName ?? 'Unknown user',
        cancelledByEmail: b.cancelledByEmail ?? '',
        reason:           b.cancellationReason ?? '—',
        cancelledAt:      b.cancelledAt ?? b.cancelRequestedAt ?? new Date(),
        // The accounts system may write the status without naming anyone.
        approvedByName:   b.cancelDecidedByName ?? 'Accounts Team',
        approvedByEmail:  b.cancelDecidedByEmail,
        approvedAt:       b.cancelDecidedAt ?? b.cancelledAt,
        approvalNote:     b.cancelDecisionNote,
      })
      result.sent++
      console.log(`[CancelWatch] ✓ cancellation notice sent for ${b.bookingRef}`)
    } catch (err) {
      // Release the claim so the next tick retries this booking.
      await prisma.booking.update({
        where: { id: b.id },
        data:  { cancelMailSentAt: null },
      }).catch(() => {})
      result.failed++
      console.error(
        `[CancelWatch] cancellation notice failed for ${b.bookingRef}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return result
}
