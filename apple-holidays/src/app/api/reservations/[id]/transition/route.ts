/**
 * POST /api/reservations/:id/transition — move a reservation's status.
 *
 * The only way status changes. `reservation-state.ts` decides legality and
 * `reservations-write.ts` runs the guard; this route neither duplicates nor
 * bypasses either. A refused accuracy gate comes back as 422 with the failing
 * checks in `detail`, so the drawer can render them inline.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertReservationInScope } from '@/lib/reservation-guard'
import { transitionReservation, ReservationError } from '@/lib/reservations-write'
import type { UserRole } from '@prisma/client'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Cancelling is gated on its own permission; every other move needs confirm.
  const body = await req.json().catch(() => ({}))
  const needsCancel = body?.to === 'CANCELLED' || body?.to === 'CANCEL_REQUESTED'

  const g = await guardReservation(needsCancel ? 'reservation:cancel' : 'reservation:confirm')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }
  if (!body?.to) return buildApiError('`to` status is required', 422)

  try {
    const row = await transitionReservation(
      params.id,
      {
        to: body.to,
        note: body.note ?? null,
        waivers: body.waivers ?? {},
        penaltyAcknowledged: !!body.penaltyAcknowledged,
        penaltyAmount: body.penaltyAmount ?? null,
        raiseCreditNote: !!body.raiseCreditNote,
      },
      g.session.role as UserRole,
      g.session.actor,
    )
    return buildApiSuccess(row)
  } catch (e) {
    if (e instanceof ReservationError) {
      return Response.json(
        { success: false, error: e.message, detail: e.detail },
        { status: e.status },
      )
    }
    return buildApiError(e instanceof Error ? e.message : 'Transition failed', 500)
  }
}
