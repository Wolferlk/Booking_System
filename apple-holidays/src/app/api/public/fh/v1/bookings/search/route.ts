import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, runRoute } from '@/lib/public-api/fh-http'
import { searchBookings, serializeBooking } from '@/lib/public-api/fh-actions'
import { importFromAppleSystem } from '@/lib/public-api/fh-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/public/fh/v1/bookings/search?q=IS48748
 *
 * The portal's search box. Matches booking ref, IS number or CNTL number,
 * space-insensitively, and returns the full booking — flights, hotels,
 * passengers, contacts — for every hit.
 *
 * Query:
 *   q            (required) what to search for
 *   limit        1–50, default 10
 *   auto_import  when `true` and nothing matches locally, pull the booking from
 *                AppleSystem instead of returning an empty list
 */
export async function GET(req: NextRequest) {
  return runRoute('bookings/search', async (requestId) => {
    const caller = await requireCaller(req, 'booking:read')

    const params = req.nextUrl.searchParams
    const q = (params.get('q') || params.get('query') || params.get('ref') || '').trim()
    const limit = Number(params.get('limit') || 10)
    const autoImport = /^(1|true|yes)$/i.test(params.get('auto_import') || '')

    const results = await searchBookings(q, Number.isFinite(limit) ? limit : 10)

    if (!results.length && autoImport) {
      // Needs the import scope as well — this writes a booking.
      await requireCaller(req, 'booking:import')
      const imported = await importFromAppleSystem(caller, q)
      return apiOk(
        {
          query: q,
          count: 1,
          imported: true,
          source: imported.source,
          results: [serializeBooking(imported.booking)],
          message: `Imported ${imported.booking.bookingRef} from AppleSystem`,
        },
        200,
        requestId,
      )
    }

    return apiOk(
      {
        query: q,
        count: results.length,
        imported: false,
        results: results.map(serializeBooking),
        ...(results.length ? {} : { message: `No booking matches "${q}" — try auto_import=true` }),
      },
      200,
      requestId,
    )
  })
}
