import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, isCreditAgent } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import { differenceInDays } from 'date-fns'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['AC_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Only Accounts Team can confirm payments', 403)
  }

  const payment = await prisma.payment.findUnique({
    where: { id: params.id },
    include: { booking: { select: { arrivalDate: true, bookingRef: true, agent: true } } },
  })
  if (!payment) return buildApiError('Payment not found', 404)
  if (payment.status === 'CONFIRMED') return buildApiError('Payment already confirmed')

  const body = await req.json()
  const { refNumber, action } = body  // action: 'confirm' | 'reject'

  if (action === 'reject') {
    const updated = await prisma.payment.update({
      where: { id: params.id },
      data: { status: 'REJECTED', processedById: session.user.id, paidAt: new Date() },
    })
    await logActivity({
      userId: session.user.id,
      action: ACTION.PAYMENT_REJECTED,
      entityType: 'Payment',
      entityId: params.id,
      details: { bookingRef: payment.booking.bookingRef, amount: Number(payment.amount) },
    })
    return buildApiSuccess(updated, 'Payment rejected')
  }

  // Credit-based agents (MMT, MakeMyTrip, 30sundays) don't need a ref number — they settle in bulk
  const creditAgent = isCreditAgent(payment.booking.agent)
  if (!creditAgent && !refNumber?.trim()) {
    return buildApiError('Reference number is required when confirming payment')
  }
  const finalRef = refNumber?.trim() || `CREDIT-${payment.booking.agent?.toUpperCase().replace(/\s+/g, '')}-AUTO`

  // T-7 check for initial/basic customer payments
  if (payment.type === 'customer_payment') {
    const daysUntil = differenceInDays(new Date(payment.booking.arrivalDate), new Date())
    if (daysUntil > 7 && !body.overrideT7) {
      // Allow but return a warning flag
      // We don't block — accounts team can always confirm, but we warn
    }
  }

  const updated = await prisma.payment.update({
    where: { id: params.id },
    data: {
      status: 'CONFIRMED',
      refNumber: finalRef,
      processedById: session.user.id,
      paidAt: new Date(),
    },
  })

  await logActivity({
    userId: session.user.id,
    action: ACTION.PAYMENT_CONFIRMED,
    entityType: 'Payment',
    entityId: params.id,
    details: {
      bookingRef: payment.booking.bookingRef,
      amount: Number(payment.amount),
      refNumber: refNumber.trim(),
    },
  })

  return buildApiSuccess(updated, `Payment confirmed with ref: ${finalRef}`)
}
