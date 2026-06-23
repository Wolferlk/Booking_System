import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['GT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)
  if (booking.status !== 'OPERATIONS_READY') return buildApiError('Booking must be Operations Ready first')

  const [updated] = await Promise.all([
    prisma.booking.update({ where: { bookingRef: params.ref }, data: { status: 'CLIENT_LIVE' } }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id, fromState: 'OPERATIONS_READY', toState: 'CLIENT_LIVE',
        actorId: session.user.id, note: 'Client portal opened',
      },
    }),
  ])
  return buildApiSuccess(updated, 'Client portal is now live')
}
