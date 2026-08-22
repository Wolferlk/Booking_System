/**
 * GET /api/reservations/hotels/:id — one property, in full.
 *
 * The property, its supplier and its rate cards come from the live Aahaas store
 * (read-only). On top of that, if the same hotel exists as a local
 * `HotelProfile`, the ops-side trading history is attached so the desk sees the
 * contract and our record of dealing with the property on one screen. The link
 * is by `normalizeHotelName`, the same join key the rest of the system uses.
 *
 * `?expired=1` includes closed seasons; by default only contracts valid today
 * or later are returned.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { isB2cConfigured } from '@/lib/b2c-db'
import {
  fetchHotel, fetchVendor, fetchHotelRates, fetchHotelRoomSetup,
  groupRateCards, isoDay,
} from '@/lib/b2c-hotels'
import { normalizeHotelName } from '@/lib/hotel-match'
import { getPartnerStats } from '@/lib/reservations'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response

  if (!isB2cConfigured()) {
    return buildApiError('The Aahaas hotel database is not configured on this server', 503)
  }

  const hotelId = Number(params.id)
  if (!Number.isInteger(hotelId) || hotelId <= 0) return buildApiError('Invalid hotel id', 400)

  const includeExpired = req.nextUrl.searchParams.get('expired') === '1'

  try {
    const hotel = await fetchHotel(hotelId)
    if (!hotel) return buildApiError('Hotel not found in the Aahaas store', 404)

    const [vendor, rates, roomSetup] = await Promise.all([
      hotel.vendor_id ? fetchVendor(Number(hotel.vendor_id)) : Promise.resolve(null),
      fetchHotelRates(hotelId, { includeExpired }),
      fetchHotelRoomSetup(hotelId),
    ])

    const cards = groupRateCards(rates, isoDay(new Date()))

    return buildApiSuccess({
      hotel,
      vendor,
      roomSetup,
      cards,
      rateCount: rates.length,
      ops: await opsLinkage(hotel.hotel_name),
    })
  } catch (err) {
    console.error('[GET /api/reservations/hotels/:id]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to read this property', 500)
  }
}

/**
 * The local profile for this property, if we hold one, plus its trading stats.
 * Absent is the normal case for a property we have never booked, so a miss is
 * `null` rather than an error.
 */
async function opsLinkage(hotelName: string | null) {
  const normalized = normalizeHotelName(hotelName)
  if (!normalized) return null

  const profile = await prisma.hotelProfile.findUnique({
    where: { normalizedName: normalized },
    select: {
      id: true, name: true, city: true, countryCode: true,
      phone: true, email: true, whatsapp: true, whatsappVerified: true,
    },
  })
  if (!profile) return null

  return { profile, stats: await getPartnerStats(profile.id) }
}
