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
  if (!hasPermission(role, 'booking:confirm')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.status !== 'DRAFT') {
    return buildApiError('Only DRAFT bookings can be confirmed')
  }

  // Validate required data
  const passengerCount = await prisma.passenger.count({ where: { bookingId: booking.id } })
  if (passengerCount === 0) {
    return buildApiError('At least one passenger is required before confirming')
  }

  const [updated] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: { status: 'BT_CONFIRMED' },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'DRAFT',
        toState: 'BT_CONFIRMED',
        actorId: session.user.id,
        note: 'Booking confirmed by Booking Team',
      },
    }),
  ])

  return buildApiSuccess(updated, 'Booking confirmed successfully')
}
