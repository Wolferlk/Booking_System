import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getPortalConfig } from '@/lib/ticket-portal/config'
import { isB2cOriginBooking } from '@/lib/b2c-booking-sync'

export const dynamic = 'force-dynamic'

/**
 * Does the Tickets page show Issue buttons, and which tickets have portal
 * bookings? Off, a missing table or a B2C booking all read as "no desk", so the
 * page looks exactly as it did before.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const none = buildApiSuccess({ enabled: false, byTicket: {} })
  const config = await getPortalConfig()
  if (!config.enabled) return none
  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref }, select: { id: true, agent: true, status: true } })
  if (!booking || booking.status === 'CANCELLED' || (await isB2cOriginBooking(booking.id, booking.agent))) return none
  try {
    const rows = await prisma.ticketPortalBooking.findMany({
      where: { bookingId: booking.id, liveKey: { not: null } },
      select: { ticketId: true, provider: true, reference: true, status: true },
    })
    return buildApiSuccess({ enabled: true, byTicket: Object.fromEntries(rows.map(r => [r.ticketId, r])) })
  } catch {
    return none
  }
}
