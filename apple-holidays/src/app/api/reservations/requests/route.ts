/**
 * GET /api/reservations/requests — the derived request inbox.
 *
 * Accommodation lines on live bookings with no reservation row yet. Reads only;
 * nothing is created until an operator claims a stay.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { getRequestInbox } from '@/lib/reservations'

export async function GET(req: NextRequest) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response

  const p = req.nextUrl.searchParams
  const rows = await getRequestInbox({
    countries: g.session.countries,
    horizonDays: Number(p.get('horizon') ?? 365),
    includePast: p.get('includePast') === '1',
    search: p.get('q') ?? undefined,
    limit: Math.min(Number(p.get('limit') ?? 400), 800),
  })

  return buildApiSuccess({ rows, total: rows.length })
}
