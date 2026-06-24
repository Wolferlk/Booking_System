import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Only Ground Team can activate tickets', 403)
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: { booking: { select: { bookingRef: true } } },
  })
  if (!ticket) return buildApiError('Ticket not found', 404)
  if (ticket.activated) return buildApiError('Ticket already activated')

  // GT can provide reference, supplier, notes, and an already-uploaded file when activating
  const body = await req.json().catch(() => ({}))
  const { reference, supplier, notes, fileUrl, fileName, fileType } = body as {
    reference?: string; supplier?: string; notes?: string
    fileUrl?: string; fileName?: string; fileType?: string
  }

  const updated = await prisma.ticket.update({
    where: { id: params.id },
    data: {
      activated: true,
      ...(reference ? { reference } : {}),
      ...(supplier  ? { supplier  } : {}),
      ...(notes     ? { notes     } : {}),
      ...(fileUrl   ? { fileUrl, fileName: fileName || null, fileType: fileType || 'pdf' } : {}),
    },
  })

  await logActivity({
    userId: session.user.id,
    action: ACTION.TICKET_FILE_UPLOADED,
    entityType: 'Ticket',
    entityId: params.id,
    details: { type: ticket.type, bookingRef: ticket.booking.bookingRef, action: 'activated', reference },
  })

  return buildApiSuccess(updated, 'Ticket activated')
}
