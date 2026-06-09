import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import type { UserRole, DriverPaymentType } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const payments = await prisma.driverPayment.findMany({
    where: { driverId: params.id },
    include: { paidBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return buildApiSuccess(payments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['GT_USER', 'AC_USER', 'SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const driver = await prisma.driver.findUnique({ where: { id: params.id } })
  if (!driver) return buildApiError('Driver not found', 404)

  const body = await req.json()
  const { amount, type, description, refNumber } = body

  if (!amount || !type) return buildApiError('amount and type are required')

  const payment = await prisma.driverPayment.create({
    data: {
      driverId: params.id,
      amount: Number(amount),
      type: type as DriverPaymentType,
      description: description ?? null,
      refNumber: refNumber ?? null,
      paidById: session.user.id,
    },
  })

  // Update driver advance balance for ADVANCE type
  if (type === 'ADVANCE') {
    await prisma.driver.update({
      where: { id: params.id },
      data: { advanceBalance: { increment: Number(amount) } },
    })
  } else if (type === 'DEDUCTION') {
    await prisma.driver.update({
      where: { id: params.id },
      data: { advanceBalance: { decrement: Number(amount) } },
    })
  }

  await logActivity({
    userId: session.user.id,
    action: ACTION.DRIVER_PAYMENT_ADDED,
    entityType: 'Driver',
    entityId: params.id,
    details: { amount, type, driverName: driver.name },
  })

  return buildApiSuccess(payment, 'Payment recorded')
}
