/**
 * POST   /api/reservations/:id/options/:optionId — select this option
 * DELETE /api/reservations/:id/options/:optionId — drop a quote
 *
 * Selecting copies the option's commercial terms onto the reservation and
 * requires a written reason. That reason is what makes the comparison an audit
 * trail rather than a screenshot.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertReservationInScope } from '@/lib/reservation-guard'
import { selectOption, ReservationError } from '@/lib/reservations-write'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; optionId: string } },
) {
  const g = await guardReservation('reservation:edit')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }
  try {
    const { reason } = await req.json()
    return buildApiSuccess(await selectOption(params.id, params.optionId, reason, g.session.actor))
  } catch (e) {
    if (e instanceof ReservationError) return buildApiError(e.message, e.status)
    return buildApiError('Failed to select option', 500)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; optionId: string } },
) {
  const g = await guardReservation('reservation:edit')
  if (!g.ok) return g.response
  if (!(await assertReservationInScope(params.id, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }

  const option = await prisma.reservationOption.findUnique({ where: { id: params.optionId } })
  if (!option || option.reservationId !== params.id) {
    return buildApiError('Option not found on this reservation', 404)
  }
  // The selected option carries the terms the reservation is now built on;
  // removing it silently would leave the stay quoting a price nothing supports.
  if (option.selected) {
    return buildApiError('Select a different option before removing the chosen one', 422)
  }

  await prisma.$transaction(async tx => {
    await tx.reservationOption.delete({ where: { id: params.optionId } })
    await tx.reservationEvent.create({
      data: {
        reservationId: params.id,
        action: 'option_removed',
        note: option.hotelName,
        actorName: g.session.actor.name ?? null,
        actorEmail: g.session.actor.email ?? null,
      },
    })
  })

  return buildApiSuccess({ removed: params.optionId })
}
