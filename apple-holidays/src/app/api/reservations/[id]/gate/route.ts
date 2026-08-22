/**
 * GET /api/reservations/:id/gate — run the accuracy gate without confirming.
 *
 * Lets the drawer show the checklist live while an operator is still filling
 * fields in, rather than only at the moment they press Confirm.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertReservationInScope } from '@/lib/reservation-guard'
import { evaluateGate, ReservationError } from '@/lib/reservations-write'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }

  try {
    return buildApiSuccess(await evaluateGate(params.id))
  } catch (e) {
    if (e instanceof ReservationError) return buildApiError(e.message, e.status)
    return buildApiError('Gate evaluation failed', 500)
  }
}
