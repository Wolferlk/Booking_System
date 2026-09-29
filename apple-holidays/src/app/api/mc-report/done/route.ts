import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isSriLanka } from '@/lib/mc-report-fields'
import { MC_DONE_NOT_READY, isMcDoneMissing, setMcDone } from '@/lib/mc-done'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Mark MC Report movements done (or undo it).
 * Body `{ agendaItemIds: string[], done: boolean }`. Sri Lanka movements only —
 * anything else in the list is skipped and counted back.
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:edit')) return buildApiError('Forbidden', 403)

  const { agendaItemIds, done } = await req.json()
  if (!Array.isArray(agendaItemIds) || agendaItemIds.length === 0 || agendaItemIds.some(id => typeof id !== 'string')) {
    return buildApiError('agendaItemIds is required')
  }
  if (agendaItemIds.length > 1000) return buildApiError('Too many movements at once')
  if (typeof done !== 'boolean') return buildApiError('done must be true or false')

  const found = await prisma.agendaItem.findMany({
    where: { id: { in: agendaItemIds } },
    select: { id: true, agenda: { select: { booking: { select: { bookingRef: true, operationCountry: true } } } } },
  })
  const items = found
    .filter(i => isSriLanka(i.agenda.booking.operationCountry))
    .map(i => ({ agendaItemId: i.id, bookingRef: i.agenda.booking.bookingRef }))
  if (!items.length) return buildApiError('None of these movements are Sri Lanka movements — reload the report', 400)

  try {
    const marks = await setMcDone(
      items, done,
      { id: session.user.id, name: session.user.name ?? session.user.email ?? null },
    )
    return buildApiSuccess({ marks, skipped: agendaItemIds.length - items.length }, done ? 'Marked done' : 'Marked not done')
  } catch (err) {
    if (isMcDoneMissing(err)) return buildApiError(MC_DONE_NOT_READY, 503)
    throw err
  }
}
