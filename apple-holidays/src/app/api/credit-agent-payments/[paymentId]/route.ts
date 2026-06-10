import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole, CreditPaymentStatus } from '@prisma/client'

export async function PUT(
  req: NextRequest,
  { params }: { params: { paymentId: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { amountPaid, status, paidAt, reference, notes, bookingRefs } = body

  const payment = await prisma.creditAgentPayment.update({
    where: { id: params.paymentId },
    data: {
      amountPaid: amountPaid !== undefined ? Number(amountPaid) : undefined,
      status: status as CreditPaymentStatus | undefined,
      paidAt: paidAt ? new Date(paidAt) : undefined,
      reference: reference ?? undefined,
      notes: notes ?? undefined,
      bookingRefs: bookingRefs !== undefined ? (bookingRefs ? JSON.stringify(bookingRefs) : null) : undefined,
      processedById: session.user.id,
    },
  })
  return buildApiSuccess(payment)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { paymentId: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  await prisma.creditAgentPayment.delete({ where: { id: params.paymentId } })
  return buildApiSuccess({ deleted: true })
}
