/**
 * POST /api/reservations/:id/contact — record an outbound contact or a reply.
 *
 * `direction: "in"` stamps the property's first response, which is what the
 * partner responsiveness score is computed from.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertReservationInScope } from '@/lib/reservation-guard'
import { recordContact, recordResponse, ReservationError } from '@/lib/reservations-write'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:contact')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }

  try {
    const { channel, note, direction } = await req.json()
    const row = direction === 'in'
      ? await recordResponse(params.id, note ?? null, g.session.actor)
      : await recordContact(params.id, channel ?? 'EMAIL', note ?? null, g.session.actor)
    return buildApiSuccess(row)
  } catch (e) {
    if (e instanceof ReservationError) return buildApiError(e.message, e.status)
    return buildApiError('Failed to record contact', 500)
  }
}
