import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'BT_USER'].includes(role)) return buildApiError('Forbidden', 403)

  const payments = await prisma.creditAgentPayment.findMany({
    where: { agentId: params.id },
    orderBy: { dueDate: 'desc' },
    include: { processedBy: { select: { id: true, name: true } } },
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
  if (!['AC_USER', 'SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const agent = await prisma.creditAgent.findUnique({ where: { id: params.id } })
  if (!agent) return buildApiError('Agent not found', 404)

  const body = await req.json()
  const {
    periodStart, periodEnd, dueDate,
    bookingRefs, amountDue, amountPaid,
    currency, status, paidAt, reference, notes,
  } = body

  if (!periodStart || !periodEnd || !dueDate || !amountDue) {
    return buildApiError('Period, due date and amount due are required')
  }

  const payment = await prisma.creditAgentPayment.create({
    data: {
      agentId: params.id,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      dueDate: new Date(dueDate),
      bookingRefs: bookingRefs ? JSON.stringify(bookingRefs) : null,
      amountDue: Number(amountDue),
      amountPaid: amountPaid ? Number(amountPaid) : 0,
      currency: currency || agent.currency || 'USD',
      status: status || 'PENDING',
      paidAt: paidAt ? new Date(paidAt) : null,
      reference: reference || null,
      notes: notes || null,
      processedById: session.user.id,
    },
  })

  return buildApiSuccess(payment, 201)
}
