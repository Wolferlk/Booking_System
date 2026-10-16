import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { whatsappInboxCountry } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  // The Vietnam desk reads only its own bookings' chats — same scope as the inbox.
  const scopeCountry = whatsappInboxCountry(session.user.role)
  if (scopeCountry) {
    const booking = await prisma.booking.findUnique({
      where:  { bookingRef: params.ref },
      select: { operationCountry: true },
    })
    if (booking?.operationCountry !== scopeCountry) return buildApiError('Forbidden', 403)
  }

  const messages = await prisma.whatsAppMessage.findMany({
    where:   { bookingRef: params.ref },
    orderBy: { createdAt: 'asc' },
  })

  return buildApiSuccess(messages)
}
