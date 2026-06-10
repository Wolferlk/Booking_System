import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

// AC_USER manually advances AWAITING_PAYMENT_CONFIRM → OPERATIONS_READY
// (auto-advances happen per-line; this is the manual override when all confirmed)
export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      pnl: { include: { lineItems: { select: { paymentStatus: true } } } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  if (booking.status !== 'AWAITING_PAYMENT_CONFIRM') return buildApiError('Booking must be in Awaiting Payment state')

  // Check all lines confirmed
  const lines = booking.pnl?.lineItems ?? []
  const allConfirmed = lines.length > 0 && lines.every(l => l.paymentStatus === 'CONFIRMED')
  if (!allConfirmed && role !== 'SUPER_ADMIN') {
    return buildApiError('All P&L line payments must be confirmed before advancing (or use SUPER_ADMIN override)')
  }

  const [updated] = await Promise.all([
    prisma.booking.update({ where: { bookingRef: params.ref }, data: { status: 'OPERATIONS_READY' } }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: 'AWAITING_PAYMENT_CONFIRM',
        toState: 'OPERATIONS_READY',
        actorId: session.user.id,
        note: 'All payments confirmed — operations ready',
      },
    }),
  ])
  return buildApiSuccess(updated, 'Booking is now Operations Ready')
}
