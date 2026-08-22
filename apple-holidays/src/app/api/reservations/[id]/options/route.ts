/**
 * GET  /api/reservations/:id/options — the comparison board
 * POST /api/reservations/:id/options — add a quote
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertReservationInScope } from '@/lib/reservation-guard'
import { addOption, ReservationError } from '@/lib/reservations-write'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }
  const rows = await prisma.reservationOption.findMany({
    where: { reservationId: params.id },
    orderBy: [{ selected: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return buildApiSuccess(rows)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:edit')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }
  try {
    const body = await req.json()
    for (const f of ['quotedAt', 'quoteValidUntil', 'freeCancelUntil']) {
      if (body[f]) body[f] = new Date(body[f])
    }
    return buildApiSuccess(await addOption(params.id, body, g.session.actor), 201)
  } catch (e) {
    if (e instanceof ReservationError) return buildApiError(e.message, e.status)
    return buildApiError('Failed to add option', 500)
  }
}
