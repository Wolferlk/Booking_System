/**
 * GET  /api/reservations/:id/special-requests
 * POST /api/reservations/:id/special-requests — add or update one
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertReservationInScope } from '@/lib/reservation-guard'
import { upsertSpecialRequest, ReservationError } from '@/lib/reservations-write'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }
  return buildApiSuccess(
    await prisma.reservationSpecialRequest.findMany({
      where: { reservationId: params.id },
      orderBy: { requestedAt: 'asc' },
    }),
  )
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:edit')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }
  try {
    const body = await req.json()
    if (!body.kind) return buildApiError('`kind` is required', 422)
    return buildApiSuccess(await upsertSpecialRequest(params.id, body, g.session.actor))
  } catch (e) {
    if (e instanceof ReservationError) return buildApiError(e.message, e.status)
    return buildApiError('Failed to save special request', 500)
  }
}
