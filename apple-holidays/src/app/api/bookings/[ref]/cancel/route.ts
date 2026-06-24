import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
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

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (!CANCELLABLE_STATES.includes(booking.status as BookingStatus)) {
    return buildApiError(`Cannot cancel booking in ${booking.status} state`)
  }

  const { reason } = await req.json()
  if (!reason) return buildApiError('Cancellation reason is required')

  const [updated] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: { status: 'CANCELLED' },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: booking.status,
        toState: 'CANCELLED',
        actorId: session.user.id,
        note: reason,
      },
    }),
  ])

  return buildApiSuccess(updated, 'Booking cancelled')
}
