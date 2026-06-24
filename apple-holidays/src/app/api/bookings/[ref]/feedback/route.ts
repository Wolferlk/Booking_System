import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)
  if (booking.status !== 'FEEDBACK_DONE') {
    return buildApiError('Booking must be in Feedback Done status to complete')
  }

  const body = await req.json() as { rating?: number; comment?: string }
  const rating = body.rating ? Number(body.rating) : null
  const comment = body.comment?.trim() || null

  if (rating !== null && (rating < 1 || rating > 5)) {
    return buildApiError('Rating must be between 1 and 5')
  }

  await prisma.$transaction([
    prisma.customerFeedback.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        rating,
        comment,
        savedById: session.user.id,
      },
      update: {
        rating,
        comment,
        savedById: session.user.id,
      },
    }),
    prisma.booking.update({
      where: { bookingRef: params.ref },
      data: { status: 'COMPLETED' },
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'FEEDBACK_DONE',
        toState: 'COMPLETED',
        actorId: session.user.id,
        note: 'Trip completed with customer feedback',
      },
    }),
  ])

  return buildApiSuccess(null, 'Trip completed and feedback saved')
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: { customerFeedback: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  return buildApiSuccess(booking.customerFeedback)
}
