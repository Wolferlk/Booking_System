import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { MC_FIELD_META, isMcField, mcCurrencyFor, mcFieldApplies } from '@/lib/mc-report-fields'
import { McDetailInputError, MC_DETAILS_NOT_READY, isMcDetailsMissing, setMcDetail } from '@/lib/mc-details'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Save one MC Report desk figure on one movement.
 * Body `{ agendaItemId, field, value }`; a blank value clears it. Which fields a
 * movement takes depends on its booking's country — see mc-report-fields.ts.
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:edit')) return buildApiError('Forbidden', 403)

  const { agendaItemId, field, value } = await req.json()
  if (!agendaItemId || typeof agendaItemId !== 'string') return buildApiError('agendaItemId is required')
  if (!isMcField(field)) return buildApiError('Unknown field')

  const item = await prisma.agendaItem.findUnique({
    where: { id: agendaItemId },
    select: { agenda: { select: { booking: { select: { bookingRef: true, operationCountry: true } } } } },
  })
  if (!item) return buildApiError('Movement not found — reload the report', 404)
  const booking = item.agenda.booking
  if (!mcFieldApplies(field, booking.operationCountry)) {
    return buildApiError(`${MC_FIELD_META[field].label} is not used for this booking's country`, 400)
  }

  try {
    const saved = await setMcDetail(
      agendaItemId, booking.bookingRef, field, value,
      mcCurrencyFor(booking.operationCountry, booking.bookingRef),
      { id: session.user.id, name: session.user.name ?? session.user.email ?? null },
    )
    return buildApiSuccess({ details: saved }, 'Saved')
  } catch (err) {
    if (err instanceof McDetailInputError) return buildApiError(err.message, 400)
    if (isMcDetailsMissing(err)) return buildApiError(MC_DETAILS_NOT_READY, 503)
    throw err
  }
}
