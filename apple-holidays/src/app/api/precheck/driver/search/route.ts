import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardPrecheck } from '@/lib/precheck-guard'
import { searchAssignableDrivers } from '@/lib/driver-precheck'

export const dynamic = 'force-dynamic'

/**
 * GET /api/precheck/driver/search — registered drivers for the picker.
 *
 * Scoped to the booking's country and its tour dates, so each option carries
 * any clash with another booking over the same days. Read-only.
 */
export async function GET(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard

  const sp = req.nextUrl.searchParams
  const bookingRef = (sp.get('bookingRef') ?? '').trim()

  let country: string | null = null
  let from: Date | null = null
  let to: Date | null = null

  if (bookingRef) {
    const booking = await prisma.booking.findUnique({
      where: { bookingRef },
      select: { operationCountry: true, arrivalDate: true, departureDate: true },
    })
    if (!booking) return buildApiError('Booking not found', 404)
    if (session.countries && !(booking.operationCountry && session.countries.includes(booking.operationCountry))) {
      return buildApiError('Forbidden', 403)
    }
    country = booking.operationCountry
    from = booking.arrivalDate
    to = booking.departureDate
  }

  try {
    const drivers = await searchAssignableDrivers({
      query: sp.get('q'),
      country,
      from,
      to,
      excludeBookingRef: bookingRef || null,
      limit: Number(sp.get('limit') ?? 25),
    })
    return buildApiSuccess(drivers)
  } catch (e) {
    console.error('[precheck/driver/search]', e)
    return buildApiError((e as Error).message, 500)
  }
}
