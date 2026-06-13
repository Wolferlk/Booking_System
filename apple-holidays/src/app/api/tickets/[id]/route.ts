import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

const CAN_EDIT: UserRole[] = ['GT_USER', 'TE_USER', 'SUPER_ADMIN']

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { id } = await params
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      booking: { select: { bookingRef: true, arrivalDate: true, agent: true } },
      agendaItem: { select: { date: true, location: true } },
      pnlLine: { select: { activity: true, paymentStatus: true, paymentRefNumber: true, category: true } },
    },
  })
  if (!ticket) return buildApiError('Ticket not found', 404)
  return buildApiSuccess(ticket)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!CAN_EDIT.includes(role)) return buildApiError('Forbidden', 403)

  const { id } = await params
  const existing = await prisma.ticket.findUnique({ where: { id } })
  if (!existing) return buildApiError('Ticket not found', 404)

  const body = await req.json()
  const { type, supplier, qty, costPerUnit, currency, reference, notes } = body

  const parsedQty  = qty  != null ? Number(qty)  : undefined
  const parsedCost = costPerUnit != null ? (costPerUnit === '' ? null : Number(costPerUnit)) : undefined
  const totalCost  = parsedCost != null && parsedQty != null
    ? parsedCost * parsedQty
    : parsedCost != null
      ? parsedCost * existing.qty
      : parsedQty != null && existing.costPerUnit != null
        ? Number(existing.costPerUnit) * parsedQty
        : undefined

  const ticket = await prisma.ticket.update({
    where: { id },
    data: {
      ...(type      != null && { type }),
      ...(supplier  != null && { supplier: supplier || null }),
      ...(parsedQty != null && { qty: parsedQty }),
      ...(parsedCost !== undefined && { costPerUnit: parsedCost }),
      ...(totalCost  !== undefined && { totalCost }),
      ...(currency  != null && { currency }),
      ...(reference != null && { reference: reference || null }),
      ...(notes     != null && { notes: notes || null }),
    },
    include: {
      booking: { select: { bookingRef: true } },
      pnlLine: { select: { activity: true, paymentStatus: true, paymentRefNumber: true, category: true } },
    },
  })

  return buildApiSuccess(ticket, 'Ticket updated')
}
