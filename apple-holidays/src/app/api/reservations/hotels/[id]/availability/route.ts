/**
 * GET /api/reservations/hotels/:id/availability — can we actually sell this
 * property for these dates, and at what price?
 *
 * Answers night by night against the live contract: booking window, blackout
 * dates, blackout weekdays, stop-sale, remaining daily allotment, the book-by
 * lead time and occupancy limits. Read-only — it inspects the live store and
 * holds nothing.
 *
 * Query: checkIn, checkOut (required, YYYY-MM-DD), adults, childrenWithBed,
 *        childrenNoBed, rooms, nationality, expired=1
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { isB2cConfigured } from '@/lib/b2c-db'
import {
  fetchHotel, fetchHotelRates, fetchDailyInventory,
  evaluateAvailability, nightsIn, isoDay,
} from '@/lib/b2c-hotels'

export const dynamic = 'force-dynamic'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response

  if (!isB2cConfigured()) {
    return buildApiError('The Aahaas hotel database is not configured on this server', 503)
  }

  const hotelId = Number(params.id)
  if (!Number.isInteger(hotelId) || hotelId <= 0) return buildApiError('Invalid hotel id', 400)

  const p = req.nextUrl.searchParams
  const checkIn = p.get('checkIn') ?? ''
  const checkOut = p.get('checkOut') ?? ''
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    return buildApiError('checkIn and checkOut are required as YYYY-MM-DD', 422)
  }
  if (checkOut <= checkIn) return buildApiError('checkOut must be after checkIn', 422)

  const nights = nightsIn(checkIn, checkOut)
  if (nights.length > 60) return buildApiError('Stays longer than 60 nights are not quoted here', 422)

  try {
    const hotel = await fetchHotel(hotelId)
    if (!hotel) return buildApiError('Hotel not found in the Aahaas store', 404)

    // Expired seasons are excluded unless asked for: a rate that closed last
    // year can never be the answer, and including them only adds noise.
    const [rates, daily] = await Promise.all([
      fetchHotelRates(hotelId, { includeExpired: p.get('expired') === '1' }),
      // Last night of the stay is checkOut - 1, which `nights` already holds.
      fetchDailyInventory(hotelId, checkIn, nights[nights.length - 1]),
    ])

    const results = evaluateAvailability(rates, daily, {
      checkIn,
      checkOut,
      adults: intParam(p.get('adults'), 2),
      childrenWithBed: intParam(p.get('childrenWithBed'), 0),
      childrenNoBed: intParam(p.get('childrenNoBed'), 0),
      rooms: intParam(p.get('rooms'), 1),
      nationality: p.get('nationality'),
      asOf: isoDay(new Date()),
    })

    const sellable = results.filter(r => r.available)

    return buildApiSuccess({
      hotel: { id: hotel.id, name: hotel.hotel_name, city: hotel.city, country: hotel.country },
      checkIn,
      checkOut,
      nights: nights.length,
      // The desk's real question is "yes or no", so answer it before the detail.
      verdict: sellable.length > 0 ? 'available' : results.length > 0 ? 'blocked' : 'no-contract',
      sellableCount: sellable.length,
      results,
      /** Set when the property keeps no per-date allotment: quotes are on request. */
      onRequestOnly: daily.length === 0,
    })
  } catch (err) {
    console.error('[GET /api/reservations/hotels/:id/availability]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to check availability', 500)
  }
}

function intParam(raw: string | null, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback
}
