/**
 * GET /api/reservations/hotels/availability — find every contracted property
 * that can sell at least one rate for the requested stay.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { isB2cConfigured } from '@/lib/b2c-db'
import { isoDay, nightsIn, searchAvailableHotels } from '@/lib/b2c-hotels'

export const dynamic = 'force-dynamic'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response
  if (!isB2cConfigured()) return buildApiError('The Aahaas hotel database is not configured on this server', 503)

  const p = req.nextUrl.searchParams
  const checkIn = p.get('checkIn') ?? ''
  const checkOut = p.get('checkOut') ?? ''
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    return buildApiError('checkIn and checkOut are required as YYYY-MM-DD', 422)
  }
  if (checkOut <= checkIn) return buildApiError('checkOut must be after checkIn', 422)
  const nights = nightsIn(checkIn, checkOut)
  if (nights.length > 60) return buildApiError('Stays longer than 60 nights are not quoted here', 422)

  const intParam = (raw: string | null, fallback: number) => {
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback
  }

  try {
    const hotels = await searchAvailableHotels({
      checkIn,
      checkOut,
      adults: intParam(p.get('adults'), 2),
      childrenWithBed: intParam(p.get('childrenWithBed'), 0),
      childrenNoBed: intParam(p.get('childrenNoBed'), 0),
      rooms: intParam(p.get('rooms'), 1),
      nationality: p.get('nationality'),
      country: p.get('country'),
      city: p.get('city'),
      asOf: isoDay(new Date()),
    })
    return buildApiSuccess({
      checkIn,
      checkOut,
      nights: nights.length,
      total: hotels.length,
      hotels: hotels.map(row => ({
        hotel: row.hotel,
        sellableRates: row.sellableRates.length,
        lowestPrice: row.lowestPrice,
        currency: row.currency,
        rates: row.sellableRates.slice(0, 5),
      })),
    })
  } catch (err) {
    console.error('[GET /api/reservations/hotels/availability]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to search hotel availability', 500)
  }
}
