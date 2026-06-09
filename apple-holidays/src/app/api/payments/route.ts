import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const bookingRef = searchParams.get('bookingRef')

  const where: Record<string, unknown> = {}
  if (bookingRef) {
    const booking = await prisma.booking.findUnique({ where: { bookingRef } })
    if (booking) where.bookingId = booking.id
  }

  const payments = await prisma.payment.findMany({
    where,
    include: {
      booking: { select: { bookingRef: true } },
      processedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return buildApiSuccess(payments)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'payment:create')) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json()
  const { bookingRef, type, amount, currency, method, reference, notes, paidAt } = body

  if (!bookingRef || !amount) return buildApiError('bookingRef and amount are required')

  const booking = await prisma.booking.findUnique({ where: { bookingRef } })
  if (!booking) return buildApiError('Booking not found', 404)

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      type: type ?? 'customer_payment',
      amount: Number(amount),
      currency: currency ?? 'USD',
      method,
      reference,
      notes,
      status: 'COMPLETE',
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      processedById: session.user.id,
    },
  })

  return buildApiSuccess(payment, 'Payment recorded')
}
