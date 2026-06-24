import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, getDaysUntilTrip } from '@/lib/utils'
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
  if (!hasPermission(role, 'recheck:confirm')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  const daysUntil = getDaysUntilTrip(booking.arrivalDate)
  if (daysUntil > 7) {
    return buildApiError(`T−7 recheck not yet applicable (${daysUntil} days until trip)`)
  }

  const { note } = await req.json()

  const updated = await prisma.booking.update({
    where: { bookingRef: params.ref },
    data: {
      recheckCompletedAt: new Date(),
      recheckCompletedBy: session.user.id,
    },
  })

  await prisma.statusEvent.create({
    data: {
      bookingId: booking.id,
      fromState: booking.status,
      toState: booking.status,
      actorId: session.user.id,
      note: note ?? 'T−7 confirmation recheck completed',
    },
  })

  return buildApiSuccess(updated, 'T−7 recheck completed')
}
