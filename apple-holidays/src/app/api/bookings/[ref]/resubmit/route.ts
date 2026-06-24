import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'booking:resubmit')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.status !== 'CHANGE_REQUESTED') {
    return buildApiError('Can only resubmit bookings in CHANGE_REQUESTED state')
  }

  const { note } = await req.json()

  // Resolve all open change requests
  const [updated] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: { status: 'BT_CONFIRMED' },
    }),
    prisma.changeRequest.updateMany({
      where: { bookingId: booking.id, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedNote: note ?? 'Resolved on resubmission',
      },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'CHANGE_REQUESTED',
        toState: 'BT_CONFIRMED',
        actorId: session.user.id,
        note: note ?? 'Resubmitted after corrections',
      },
    }),
  ])

  return buildApiSuccess(updated, 'Booking resubmitted to Ground Team')
}
