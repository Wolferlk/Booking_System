import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import { handlePrismaApiError } from '@/lib/prisma-error'
import type { UserRole, DriverPaymentType } from '@prisma/client'

const MAX_DRIVER_PAYMENT_AMOUNT = 99_999_999.99

export const dynamic = 'force-dynamic'
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
  if (!['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const driver = await prisma.driver.findUnique({ where: { id: params.id } })
  if (!driver) return buildApiError('Driver not found', 404)

  const body = await req.json()
  const { amount, type, description, refNumber } = body

  if (!amount || !type) return buildApiError('Amount and payment type are required', 400)

  const amountText = String(amount).trim()
  const numericAmount = Number(amountText)
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return buildApiError('', 400)
  }
  if (numericAmount > MAX_DRIVER_PAYMENT_AMOUNT) {
    return buildApiError(`Amount cannot exceed ${MAX_DRIVER_PAYMENT_AMOUNT.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 400)
  }

  let payment
  try {
    payment = await prisma.driverPayment.create({
      data: {
        driverId: params.id,
        amount: numericAmount,
        type: type as DriverPaymentType,
        description: description ?? null,
        refNumber: refNumber ?? null,
        paidById: session.user.id,
      },
    })
  } catch (error) {
    return handlePrismaApiError(error, 'Failed to record payment', 'A payment with these details already exists')
  }
  // Update driver advance balance for ADVANCE type
  if (type === 'ADVANCE') {
    await prisma.driver.update({
      where: { id: params.id },
      data: { advanceBalance: { increment: numericAmount } },
    })
  } else if (type === 'DEDUCTION') {
    await prisma.driver.update({
      where: { id: params.id },
      data: { advanceBalance: { decrement: numericAmount } },
    })
  }

  await logActivity({
    userId: session.user.id,
    action: ACTION.DRIVER_PAYMENT_ADDED,
    entityType: 'Driver',
    entityId: params.id,
    details: { amount: numericAmount, type, driverName: driver.name },
  })

  return buildApiSuccess(payment, 'Payment recorded')
}
