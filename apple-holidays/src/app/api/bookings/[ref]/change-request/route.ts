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
  if (!hasPermission(role, 'booking:ground_review')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.status !== 'GT_REVIEW') {
    return buildApiError('Can only request changes during GT_REVIEW state')
  }

  const { notes, targetField } = await req.json()
  if (!notes) return buildApiError('Change request notes are required')

  const [updated, changeRequest] = await Promise.all([
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: { status: 'CHANGE_REQUESTED' },
    }),
    prisma.changeRequest.create({
      data: {
        bookingId: booking.id,
        raisedById: session.user.id,
        notes,
        targetField,
      },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'GT_REVIEW',
        toState: 'CHANGE_REQUESTED',
        actorId: session.user.id,
        note: notes,
      },
    }),
  ])

  return buildApiSuccess({ booking: updated, changeRequest }, 'Change request submitted')
}
