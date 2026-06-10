import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

// TE_USER: confirms with client → GT_REVIEW → GT_VERIFIED ("Client Confirmed")
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['TE_USER', 'SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)
  if (booking.status !== 'GT_REVIEW') return buildApiError('Booking must be in Travel Experience Review state')

  const { note } = await req.json().catch(() => ({ note: '' }))

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
        note: note || 'Client confirmed by Travel Experience Team',
      },
    }),
  ])

  return buildApiSuccess(updated, 'Client confirmed — booking ready for operations')
}
