import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendOperationsReadyEmail } from '@/lib/send-operations-email'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// GT_USER / TE_USER advances GT_VERIFIED → OPERATIONS_READY after allocating drivers
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
  if (booking.status !== 'GT_VERIFIED') return buildApiError('Booking must be in Client Confirmed state first')

  const [updated] = await Promise.all([
    prisma.booking.update({ where: { bookingRef: params.ref }, data: { status: 'OPERATIONS_READY' } }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'GT_VERIFIED',
        toState: 'OPERATIONS_READY',
        actorId: session.user.id,
        note: 'Drivers allocated — booking marked as Operations Ready',
      },
    }),
  ])
  // Fire-and-forget — does not block the response
  sendOperationsReadyEmail(params.ref).catch(err =>
    console.error('[mark-operations-ready] Email failed:', err),
  )

  return buildApiSuccess(updated, 'Booking is now Operations Ready')
}
