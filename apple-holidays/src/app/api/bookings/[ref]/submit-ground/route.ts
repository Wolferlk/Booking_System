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
  if (!hasPermission(role, 'booking:submit_ground')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.status !== 'BT_CONFIRMED') {
    return buildApiError('Only BT_CONFIRMED bookings can be submitted to Ground Team')
  }

  const [updated] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: { status: 'GT_REVIEW' },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'BT_CONFIRMED',
        toState: 'GT_REVIEW',
        actorId: session.user.id,
        note: 'Submitted to Ground Team for review',
      },
    }),
  ])

  return buildApiSuccess(updated, 'Booking submitted to Ground Team')
}
