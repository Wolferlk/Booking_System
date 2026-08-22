/**
 * GET /api/reservations/hotels — the contracted hotel directory, read live out
 * of the Aahaas store (`production_live1`).
 *
 * Read-only by construction: every statement runs through the guarded
 * `b2cQuery`, and there is no POST/PUT/DELETE on this resource. Nothing this
 * route can do writes to the live database.
 *
 * Query: search, country, city, status=active|inactive|all, liveRates=1,
 *        noLiveRates=1, limit, offset, facets=1
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { isB2cConfigured } from '@/lib/b2c-db'
import { fetchHotelDirectory, fetchHotelFacets, isoDay } from '@/lib/b2c-hotels'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response

  if (!isB2cConfigured()) {
    return buildApiError('The Aahaas hotel database is not configured on this server', 503)
  }

  const p = req.nextUrl.searchParams
  try {
    const [directory, facets] = await Promise.all([
      fetchHotelDirectory({
        search: p.get('search'),
        country: p.get('country'),
        city: p.get('city'),
        status: p.get('status') ?? 'active',
        withLiveRates: p.get('liveRates') === '1',
        // "No live rates" is the contract-renewal worklist: nothing valid today
        // or later, so the property is effectively unsellable until re-loaded.
        expiringBefore: p.get('noLiveRates') === '1' ? isoDay(new Date()) : null,
        limit: Number(p.get('limit') ?? 50),
        offset: Number(p.get('offset') ?? 0),
      }),
      p.get('facets') === '1' ? fetchHotelFacets() : Promise.resolve(null),
    ])

    return buildApiSuccess({
      rows: directory.rows,
      total: directory.total,
      facets,
    })
  } catch (err) {
    console.error('[GET /api/reservations/hotels]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to read the hotel directory', 500)
  }
}
