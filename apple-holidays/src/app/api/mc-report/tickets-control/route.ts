import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import {
  setTicketsControl, isTicketsControlMissing, TICKETS_CONTROL_NOT_READY,
} from '@/lib/tickets-control'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Save the MC Report "Tickets Control" note for one movement.
 * Body `{ agendaItemId, value }`; an empty value clears it. Vietnam only.
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:edit')) return buildApiError('Forbidden', 403)

  const { agendaItemId, value } = await req.json()
  if (!agendaItemId || typeof agendaItemId !== 'string') return buildApiError('agendaItemId is required')

  const item = await prisma.agendaItem.findUnique({
    where: { id: agendaItemId },
    select: { agenda: { select: { booking: { select: { bookingRef: true, operationCountry: true } } } } },
  })
  if (!item) return buildApiError('Movement not found — reload the report', 404)
  const booking = item.agenda.booking
  if (booking.operationCountry !== 'VIETNAM') {
    return buildApiError('Tickets Control is for Vietnam bookings only', 400)
  }

  try {
    const saved = await setTicketsControl(agendaItemId, booking.bookingRef, value, {
      id: session.user.id, name: session.user.name ?? session.user.email ?? null,
    })
    return buildApiSuccess({ value: saved }, 'Saved')
  } catch (err) {
    if (isTicketsControlMissing(err)) return buildApiError(TICKETS_CONTROL_NOT_READY, 503)
    throw err
  }
}
