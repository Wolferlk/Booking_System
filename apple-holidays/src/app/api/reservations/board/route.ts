/** GET /api/reservations/board — the Deadline Board. */
import { buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { getDeadlineBoard } from '@/lib/reservations'

export async function GET() {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response

  const board = await getDeadlineBoard(g.session.countries, g.session.actor.email)
  return buildApiSuccess(board)
}
