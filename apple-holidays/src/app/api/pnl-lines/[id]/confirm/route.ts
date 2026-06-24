import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, isCreditAgent } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { logActivity, ACTION } from '@/lib/activity'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:confirm_payment')) {
    return buildApiError('Forbidden', 403)
  }

  const line = await prisma.pNLLineItem.findUnique({
    where: { id: params.id },
    include: {
      pnl: {
        include: {
          booking: true,
          lineItems: true,
        },
      },
    },
  })

  if (!line) return buildApiError('PNL line not found', 404)

  // Credit agents never need per-line payment confirmation
  if (isCreditAgent(line.pnl.booking.agent)) {
    return buildApiError('Credit agent bookings do not require per-line payment approval', 400)
  }

  const body = await req.json()
  const { action = 'CONFIRMED', refNumber, billUrl, billName } = body
  const status = action === 'REJECTED' ? 'REJECTED' : 'CONFIRMED'

  if (status === 'CONFIRMED' && !refNumber?.trim()) {
    return buildApiError('Reference number is required when confirming payment')
  }

  const updated = await prisma.pNLLineItem.update({
    where: { id: params.id },
    data: {
      paymentStatus: status,
      paymentRefNumber: status === 'CONFIRMED' ? refNumber?.trim() : null,
      paymentBillUrl:  status === 'CONFIRMED' ? (billUrl ?? null) : null,
      paymentBillName: status === 'CONFIRMED' ? (billName ?? null) : null,
      paymentConfirmedAt: new Date(),
      paymentConfirmedBy: session.user.id,
    },
  })

  await logActivity({
    userId: session.user.id,
    action: status === 'CONFIRMED' ? ACTION.PNL_LINE_CONFIRMED : ACTION.PNL_LINE_REJECTED,
    entityType: 'Payment',
    entityId: params.id,
    details: { activity: line.activity, refNumber, bookingRef: line.pnl.booking.bookingRef },
  })

  // If all lines confirmed → advance booking to OPERATIONS_READY
  const pnl = line.pnl
  const allConfirmed = pnl.lineItems.every(
    l => l.id === params.id ? status === 'CONFIRMED' : l.paymentStatus === 'CONFIRMED',
  )

  if (allConfirmed && pnl.booking.status === 'AWAITING_PAYMENT_CONFIRM') {
    await Promise.all([
      prisma.booking.update({
        where: { id: pnl.booking.id },
        data: { status: 'OPERATIONS_READY' },
      }),
      prisma.statusEvent.create({
        data: {
          bookingId: pnl.booking.id,
          fromState: 'AWAITING_PAYMENT_CONFIRM',
          toState: 'OPERATIONS_READY',
          actorId: session.user.id,
          note: 'All P&L line payments confirmed',
        },
      }),
    ])
  }

  return buildApiSuccess(updated, `Payment ${status.toLowerCase()}`)
}
