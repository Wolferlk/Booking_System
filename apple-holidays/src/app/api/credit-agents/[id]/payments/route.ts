import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'BT_USER'].includes(role)) return buildApiError('Forbidden', 403)

  const cycles = await prisma.creditAgentPayment.findMany({
    where: { agentId: params.id },
    orderBy: { dueDate: 'desc' },
    include: { processedBy: { select: { id: true, name: true } } },
  })
  return buildApiSuccess(cycles)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const agent = await prisma.creditAgent.findUnique({
    where: { id: params.id },
    select: { currency: true },
  })
  if (!agent) return buildApiError('Agent not found', 404)

  const body = await req.json()
  const { periodStart, periodEnd, dueDate, bookingRefs, amountDue, amountPaid, currency, status, paidAt, reference, notes } = body

  if (!periodStart || !periodEnd || !dueDate) return buildApiError('Period dates and due date are required')
  if (!amountDue || Number(amountDue) <= 0) return buildApiError('Amount due must be greater than 0')

  const refs: string[] = Array.isArray(bookingRefs)
    ? bookingRefs
    : (typeof bookingRefs === 'string' ? bookingRefs.split(',').map((s: string) => s.trim()).filter(Boolean) : [])

  const paid = Number(amountPaid ?? 0)
  const due  = Number(amountDue)

  // Auto-derive status if not provided
  let derivedStatus = status || 'PENDING'
  if (!status) {
    if (paid >= due) derivedStatus = 'PAID'
    else if (paid > 0) derivedStatus = 'PARTIAL'
    else if (new Date(dueDate) < new Date()) derivedStatus = 'OVERDUE'
  }

  const cycle = await prisma.creditAgentPayment.create({
    data: {
      agentId: params.id,
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      dueDate:     new Date(dueDate),
      bookingRefs: refs.length ? JSON.stringify(refs) : null,
      amountDue:   due,
      amountPaid:  paid,
      currency:    currency || agent.currency || 'USD',
      status:      derivedStatus,
      paidAt:      paidAt ? new Date(paidAt) : (paid >= due ? new Date() : null),
      reference:   reference || null,
      notes:       notes || null,
      processedById: session.user.id,
    },
    include: { processedBy: { select: { id: true, name: true } } },
  })

  return buildApiSuccess(cycle, 201)
}
