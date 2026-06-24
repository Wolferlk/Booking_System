import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:purchase')) {
    return buildApiError('Forbidden', 403)
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: {
      pnlLine: true,
    },
  })

  if (!ticket) return buildApiError('Ticket not found', 404)

  // G2 GUARD: Cannot purchase unless the linked P&L line payment is confirmed
  if (ticket.pnlLine && ticket.pnlLine.paymentStatus !== 'CONFIRMED') {
    return buildApiError(
      'Cannot purchase ticket: P&L payment not yet confirmed by Accounts Team (Rule G2)',
      403,
    )
  }

  const { reference } = await req.json()

  const updated = await prisma.ticket.update({
    where: { id: params.id },
    data: {
      status: 'PURCHASED',
      purchasedAt: new Date(),
      reference: reference || null,
    },
  })

  return buildApiSuccess(updated, 'Ticket marked as purchased')
}
