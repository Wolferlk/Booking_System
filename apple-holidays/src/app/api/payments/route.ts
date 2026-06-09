import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import type { UserRole } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const bookingRef = searchParams.get('bookingRef')
  const status = searchParams.get('status')

  const where: Record<string, unknown> = {}
  if (bookingRef) {
    const booking = await prisma.booking.findUnique({ where: { bookingRef } })
    if (booking) where.bookingId = booking.id
  }
  if (status) where.status = status

  const payments = await prisma.payment.findMany({
    where,
    include: {
      booking: { select: { bookingRef: true } },
      processedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return buildApiSuccess(payments)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Clients cannot create payment requests', 403)

  const body = await req.json()
  const { bookingRef, type, label, amount, currency, method, reference, notes, dueDate } = body

  if (!bookingRef || !amount) return buildApiError('bookingRef and amount are required')

  const booking = await prisma.booking.findUnique({ where: { bookingRef } })
  if (!booking) return buildApiError('Booking not found', 404)

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      type: type ?? 'customer_payment',
      label: label ?? null,
      amount: Number(amount),
      currency: currency ?? 'USD',
      method: method ?? null,
      reference: reference ?? null,
      notes: notes ?? null,
      status: 'PENDING',
      dueDate: dueDate ? new Date(dueDate) : null,
      processedById: session.user.id,
    },
  })

  await logActivity({
    userId: session.user.id,
    action: ACTION.PAYMENT_CREATED,
    entityType: 'Payment',
    entityId: payment.id,
    details: { bookingRef, type, amount, label },
  })

  return buildApiSuccess(payment, 'Payment request created — awaiting Accounts confirmation')
}
