import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canTransition } from '@/lib/state-machine'
import type { BookingStatus, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// Valid step-through statuses handled by this route
const STEP_STATUSES: BookingStatus[] = [
  'TE_REVIEWED',
  'DRIVER_ALLOCATED',
  'QC1_PASS',
  'TICKETS_ISSUED',
  'QC2_PASS',
  'MSG_SENT_CUSTOMER',
  'FEEDBACK_DONE',
]

const STEP_NOTES: Record<string, string> = {
  TE_REVIEWED:        'TE reviewed',
  DRIVER_ALLOCATED:   'Driver allocated',
  QC1_PASS:           'QC1 passed',
  TICKETS_ISSUED:     'Tickets issued and activated',
  QC2_PASS:           'QC2 passed',
  MSG_SENT_CUSTOMER:  'Message sent to customer',
  FEEDBACK_DONE:      'Customer feedback recorded',
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const body = await req.json() as { to?: string }
  const toStatus = body.to as BookingStatus | undefined

  if (!toStatus || !STEP_STATUSES.includes(toStatus)) {
    return buildApiError('Invalid target status', 400)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (!canTransition(booking.status, toStatus, role)) {
    return buildApiError(`Cannot move from ${booking.status} to ${toStatus}`, 400)
  }

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

  return buildApiSuccess(updated, STEP_NOTES[toStatus] ?? 'Status updated')
}
