/**
 * GET /api/proforma/search?q=<CNTL or IS number>
 *
 * The component's front door: a reference typed off a supplier's invoice, and
 * the booking(s) it belongs to. Country scope is applied to the *results* —
 * a user who may not see Vietnam does not learn that a Vietnamese booking
 * exists by typing its number.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { searchBookings } from '@/lib/proforma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await guardReservation('proforma:read')
  if (!g.ok) return g.response

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 3) return buildApiError('Type at least 3 characters of a control or IS number', 422)

  const hits = await searchBookings(q)
  const scoped = g.session.countries
    ? hits.filter(b => b.operationCountry != null && g.session.countries!.includes(b.operationCountry))
    : hits

  return buildApiSuccess({ query: q, bookings: scoped, total: scoped.length })
}
