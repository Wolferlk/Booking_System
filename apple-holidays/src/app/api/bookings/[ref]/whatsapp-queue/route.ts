import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = ['TE_USER', 'BT_USER', 'GT_USER', 'GT_VN_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// GET — the Tour Confirmations currently QUEUED for this booking (waiting for the
// customer to reply so their 24h window opens). Powers the "message still in the
// queue?" indicator on the booking page.
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!STAFF_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const rows = await prisma.whatsAppMessage.findMany({
    where:   { bookingRef: params.ref, direction: 'outbound', status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, phone: true, body: true, mediaType: true, senderName: true, createdAt: true },
  })

  const queued = rows.map(r => ({
    id:        r.id,
    phone:     r.phone,
    preview:   (r.body ?? '').slice(0, 120),
    pdfType:   r.mediaType === 'full' ? 'full' : r.mediaType === 'confirmation' ? 'confirmation' : null,
    queuedBy:  r.senderName,
    queuedAt:  r.createdAt,
  }))

  return buildApiSuccess({ queued, count: queued.length })
}

// DELETE ?id=<messageId> — cancel a queued confirmation (marks it 'cancelled' so it
// won't be sent when the customer replies). Kept as an audit row, not deleted.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!STAFF_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return buildApiError('Message id is required')

  const row = await prisma.whatsAppMessage.findFirst({
    where: { id, bookingRef: params.ref, direction: 'outbound', status: 'pending' },
  })
  if (!row) return buildApiError('Queued message not found (it may have already been sent or cancelled)', 404)

  await prisma.whatsAppMessage.update({ where: { id }, data: { status: 'cancelled' } })
  return buildApiSuccess({ cancelled: id }, 'Queued message cancelled')
}
