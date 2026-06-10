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

  const agent = await prisma.creditAgent.findUnique({
    where: { id: params.id },
    include: {
      payments: {
        orderBy: { dueDate: 'desc' },
        include: {
          processedBy: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!agent) return buildApiError('Agent not found', 404)

  // Compute summary stats
  const cycles = agent.payments
  const totalDue    = cycles.reduce((s, c) => s + Number(c.amountDue), 0)
  const totalPaid   = cycles.reduce((s, c) => s + Number(c.amountPaid), 0)
  const outstanding = totalDue - totalPaid
  const overdue     = cycles.filter(c => c.status === 'OVERDUE').reduce((s, c) => s + Number(c.amountDue) - Number(c.amountPaid), 0)

  return buildApiSuccess({ ...agent, stats: { totalDue, totalPaid, outstanding, overdue } })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { name, aliases, contactName, contactEmail, contactPhone, creditLimit, currency, notes, isActive } = body

  const agent = await prisma.creditAgent.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(aliases !== undefined && { aliases: aliases?.length ? JSON.stringify(aliases) : null }),
      ...(contactName !== undefined && { contactName: contactName || null }),
      ...(contactEmail !== undefined && { contactEmail: contactEmail || null }),
      ...(contactPhone !== undefined && { contactPhone: contactPhone || null }),
      ...(creditLimit !== undefined && { creditLimit: creditLimit ? Number(creditLimit) : null }),
      ...(currency !== undefined && { currency }),
      ...(notes !== undefined && { notes: notes || null }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    },
  })
  return buildApiSuccess(agent)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  await prisma.creditAgent.delete({ where: { id: params.id } })
  return buildApiSuccess({ deleted: true })
}
