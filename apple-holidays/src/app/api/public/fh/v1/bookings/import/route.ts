import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, readJsonBody, runRoute, str, FhApiError } from '@/lib/public-api/fh-http'
import { serializeBooking } from '@/lib/public-api/fh-actions'
import { importFromAppleSystem } from '@/lib/public-api/fh-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/public/fh/v1/bookings/import
 * Body: { "q": "IS48748" }   (aliases: is_number, booking_ref, ref)
 *
 * Pulls a confirmed quotation from AppleSystem and creates the OPS booking, the
 * same pipeline the portal uses when a search misses. Idempotent — a booking
 * that already exists is returned with `already_existed: true`.
 */
export async function POST(req: NextRequest) {
  return runRoute('bookings/import', async (requestId) => {
    const caller = await requireCaller(req, 'booking:import')

    const body = await readJsonBody(req)
    const q = str(body, 'q', 'is_number', 'isNumber', 'booking_ref', 'bookingRef', 'ref', 'query')
    if (!q) throw new FhApiError('q (booking ref or IS number) is required', 422, 'QUERY_REQUIRED')

    const result = await importFromAppleSystem(caller, q)

    return apiOk(
      {
        booking: serializeBooking(result.booking),
        already_existed: result.already_existed,
        source: result.source,
        message: result.already_existed
          ? `${result.booking.bookingRef} already exists in OPS`
          : `Imported ${result.booking.bookingRef} from AppleSystem`,
      },
      result.already_existed ? 200 : 201,
      requestId,
    )
  })
}
