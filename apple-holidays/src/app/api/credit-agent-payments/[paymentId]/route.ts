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
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const existing = await prisma.creditAgentPayment.findUnique({ where: { id: params.paymentId } })
  if (!existing) return buildApiError('Payment cycle not found', 404)

  const body = await req.json()
  const { periodStart, periodEnd, dueDate, bookingRefs, amountDue, amountPaid, currency, status, paidAt, reference, notes } = body

  const refs: string[] | undefined = bookingRefs !== undefined
    ? (Array.isArray(bookingRefs)
        ? bookingRefs
        : String(bookingRefs).split(',').map((s: string) => s.trim()).filter(Boolean))
    : undefined

  const paid = amountPaid !== undefined ? Number(amountPaid) : Number(existing.amountPaid)
  const due  = amountDue  !== undefined ? Number(amountDue)  : Number(existing.amountDue)

  // Auto-derive status when amounts change
  let derivedStatus: CreditPaymentStatus | undefined = status as CreditPaymentStatus | undefined
  if (!derivedStatus) {
    if (paid >= due) derivedStatus = 'PAID'
    else if (paid > 0) derivedStatus = 'PARTIAL'
    else if (new Date(existing.dueDate) < new Date()) derivedStatus = 'OVERDUE'
    else derivedStatus = 'PENDING'
  }

  const updated = await prisma.creditAgentPayment.update({
    where: { id: params.paymentId },
    data: {
      ...(periodStart !== undefined && { periodStart: new Date(periodStart) }),
      ...(periodEnd   !== undefined && { periodEnd:   new Date(periodEnd) }),
      ...(dueDate     !== undefined && { dueDate:     new Date(dueDate) }),
      ...(refs        !== undefined && { bookingRefs: refs.length ? JSON.stringify(refs) : null }),
      amountDue:  due,
      amountPaid: paid,
      ...(currency  !== undefined && { currency }),
      status:     derivedStatus,
      paidAt:     paidAt !== undefined ? (paidAt ? new Date(paidAt) : null) : (paid >= due && !existing.paidAt ? new Date() : undefined),
      ...(reference !== undefined && { reference: reference || null }),
      ...(notes     !== undefined && { notes:     notes     || null }),
      processedById: session.user.id,
    },
    include: { processedBy: { select: { id: true, name: true } } },
  })

  return buildApiSuccess(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { paymentId: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  await prisma.creditAgentPayment.delete({ where: { id: params.paymentId } })
  return buildApiSuccess({ deleted: true })
}
