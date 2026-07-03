import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canTransition } from '@/lib/state-machine'
import { triggerQC1AutoSend, triggerQC2AutoSend } from '@/lib/qc-auto-send'
import type { BookingStatus, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

// These are the statuses users can manually advance to.
// QC1_PASS and QC2_PASS are intentionally omitted — they auto-trigger.
const STEP_STATUSES: BookingStatus[] = [
  'TE_REVIEWED',
  'DRIVER_ALLOCATED',
  'TICKETS_ISSUED',
  'MSG_SENT_CUSTOMER',
  'FEEDBACK_DONE',
]

const STEP_NOTES: Record<string, string> = {
  TE_REVIEWED:        'TE reviewed',
  DRIVER_ALLOCATED:   'Driver allocated — QC1 auto-triggered',
  QC1_PASS:           'QC1 auto-passed',
  TICKETS_ISSUED:     'Tickets issued and activated — QC2 auto-triggered',
  QC2_PASS:           'QC2 auto-passed',
  MSG_SENT_CUSTOMER:  'Message sent to customer',
  FEEDBACK_DONE:      'Customer feedback recorded',
}

async function autoAdvance(
  bookingId: string,
  bookingRef: string,
  fromState: BookingStatus,
  toState: BookingStatus,
  actorId: string,
): Promise<void> {
  await Promise.all([
    prisma.booking.update({ where: { bookingRef }, data: { status: toState } }),
    prisma.statusEvent.create({
      data: { bookingId, fromState, toState, actorId, note: STEP_NOTES[toState] ?? toState },
    }),
  ])
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role    = session.user.role as UserRole
  const body    = await req.json() as { to?: string }
  const toStatus = body.to as BookingStatus | undefined

  if (!toStatus || !STEP_STATUSES.includes(toStatus)) {
    return buildApiError('Invalid target status', 400)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (!canTransition(booking.status, toStatus, role)) {
    return buildApiError(`Cannot move from ${booking.status} to ${toStatus}`, 400)
  }

  // Apply the requested status change
  const [updated] = await Promise.all([
    prisma.booking.update({ where: { bookingRef: params.ref }, data: { status: toStatus } }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: booking.status,
        toState: toStatus,
        actorId: session.user.id,
        note: STEP_NOTES[toStatus] ?? toStatus,
      },
    }),
  ])

  // ── Auto-chain: DRIVER_ALLOCATED → QC1_PASS (background, non-blocking)
  if (toStatus === 'DRIVER_ALLOCATED') {
    autoAdvance(booking.id, params.ref, 'DRIVER_ALLOCATED', 'QC1_PASS', session.user.id)
      .then(() => triggerQC1AutoSend(params.ref))
      .catch(err => console.error(`[advance-status] QC1 auto-chain failed for ${params.ref}:`, err))
  }

  // ── Auto-chain: TICKETS_ISSUED → QC2_PASS (background, non-blocking)
  if (toStatus === 'TICKETS_ISSUED') {
    autoAdvance(booking.id, params.ref, 'TICKETS_ISSUED', 'QC2_PASS', session.user.id)
      .then(() => triggerQC2AutoSend(params.ref))
      .catch(err => console.error(`[advance-status] QC2 auto-chain failed for ${params.ref}:`, err))
  }

  return buildApiSuccess(updated, STEP_NOTES[toStatus] ?? 'Status updated')
}
