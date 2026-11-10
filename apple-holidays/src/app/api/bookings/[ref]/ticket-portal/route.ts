import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getPortalConfig } from '@/lib/ticket-portal/config'
import { TABLES_NOT_READY, isTableMissing } from '@/lib/ticket-portal/route'

export const dynamic = 'force-dynamic'

/**
 * Does the Tickets page show Issue buttons, and which tickets have portal
 * bookings? Off or cancelled reads as "no desk", so the page looks exactly as
 * it did before.
 *
 * `problem` says why the desk is hidden while it is switched ON: before
 * 2026-11-10 a missing table made the desk vanish with no word (Settings said
 * ON, the page showed nothing). B2C bookings use the desk too since then; a
 * ticket the store already booked through a portal is refused per ticket.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const config = await getPortalConfig()
  if (!config.enabled) return buildApiSuccess({ enabled: false, problem: null, byTicket: {} })
  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref }, select: { id: true, status: true } })
  if (!booking || booking.status === 'CANCELLED') return buildApiSuccess({ enabled: false, problem: null, byTicket: {} })
  try {
    const rows = await prisma.ticketPortalBooking.findMany({
      where: { bookingId: booking.id, liveKey: { not: null } },
      select: { ticketId: true, provider: true, reference: true, status: true },
    })
    return buildApiSuccess({ enabled: true, problem: null, byTicket: Object.fromEntries(rows.map(r => [r.ticketId, r])) })
  } catch (err) {
    console.warn('[ticket-portal] desk hidden on', params.ref, err instanceof Error ? err.message : err)
    const problem = isTableMissing(err) || !(prisma as unknown as { ticketPortalBooking?: unknown }).ticketPortalBooking
      ? `${TABLES_NOT_READY} An admin can also create them in Settings → Ticket Issue Desk.`
      : `The Ticket Issue Desk could not be read: ${err instanceof Error ? err.message.split('\n').pop()?.trim() : String(err)}`
    return buildApiSuccess({ enabled: false, problem, byTicket: {} })
  }
}
