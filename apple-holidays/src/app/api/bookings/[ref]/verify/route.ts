import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'booking:verify')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.status !== 'GT_REVIEW') {
    return buildApiError('Only GT_REVIEW bookings can be verified')
  }

  const { note } = await req.json()

  const [updated] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: { status: 'GT_VERIFIED' },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'GT_REVIEW',
        toState: 'GT_VERIFIED',
        actorId: session.user.id,
        note: note ?? 'Verified by Ground Team',
      },
    }),
  ])

  return buildApiSuccess(updated, 'Booking verified by Ground Team')
}
