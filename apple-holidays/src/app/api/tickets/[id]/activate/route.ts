import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Only Ground Team can activate tickets', 403)
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: { booking: { select: { bookingRef: true } } },
  })
  if (!ticket) return buildApiError('Ticket not found', 404)
  if (ticket.activated) return buildApiError('Ticket already activated')

  const updated = await prisma.ticket.update({
    where: { id: params.id },
    data: { activated: true },
  })

  await logActivity({
    userId: session.user.id,
    action: ACTION.TICKET_FILE_UPLOADED, // reuse closest action; or add a new one
    entityType: 'Ticket',
    entityId: params.id,
    details: { type: ticket.type, bookingRef: ticket.booking.bookingRef, action: 'activated' },
  })

  return buildApiSuccess(updated, 'Ticket activated')
}
