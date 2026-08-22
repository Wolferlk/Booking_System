/**
 * GET   /api/reservations/:id — full detail for the drawer
 * PATCH /api/reservations/:id — edit stay fields (never status)
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertReservationInScope } from '@/lib/reservation-guard'
import { getReservationDetail } from '@/lib/reservations'
import { updateReservation, ReservationError } from '@/lib/reservations-write'
import { getAvailableTransitions } from '@/lib/reservation-state'
import type { UserRole } from '@prisma/client'

/** Date-valued patch fields, parsed from ISO strings on the way in. */
const DATE_FIELDS = [
  'checkIn', 'checkOut', 'optionHeldUntil', 'freeCancelUntil',
  'paymentDueAt', 'proformaDueAt',
]

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }

  const detail = await getReservationDetail(params.id)
  if (!detail) return buildApiError('Reservation not found', 404)

  return buildApiSuccess({
    ...detail,
    transitions: getAvailableTransitions(
      detail.reservation.status as never,
      g.session.role as UserRole,
    ),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:edit')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }

  try {
    const body = await req.json()
    for (const f of DATE_FIELDS) {
      if (body[f]) body[f] = new Date(body[f])
      else if (body[f] === null) body[f] = null
    }
    const row = await updateReservation(params.id, body, g.session.actor)
    return buildApiSuccess(row)
  } catch (e) {
    if (e instanceof ReservationError) return buildApiError(e.message, e.status)
    return buildApiError(e instanceof Error ? e.message : 'Update failed', 500)
  }
}
