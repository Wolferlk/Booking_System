import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, getCancellationDeadline } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'
import { searchBookings, getQuoteTemplate, type ASBookingListItem } from '@/lib/applesystem'
import { normalizeIsNumber, mapQuoteToBooking, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId, AlreadyImportedError } from '@/lib/as-booking-import'
import { FH_BOOKING_SELECT } from '../search/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isConfirmed = (it: ASBookingListItem) => it.status === '2' || it.status_class === 'confirm'

/** The normalised IS ref for an AppleSystem row (mirrors the staff search route). */
function refOf(it: ASBookingListItem): string | null {
  const own = (it.is_number ?? '').trim()
  const raw = own && own.toUpperCase() !== 'NA'
    ? own
    : it.reference_id_full?.find(r => /^(IS|VN|SG|MY)/i.test(r))
  return raw ? normalizeIsNumber(raw) : null
}

/**
 * POST /api/filehandler/bookings/import  Body: { q }
 *
 * Called by the portal when a booking is NOT found locally. Looks the IS number
 * up on AppleSystem and, if a confirmed quotation exists, imports it into our
 * system (same pipeline as /dashboard/new-as-booking) using the automation user
 * as creator, stamps the requesting file handler, and returns the freshly-created
 * booking in the same shape as the search endpoint.
 */
export async function POST(req: NextRequest) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const q = String(body.q ?? '').trim()
  if (!q) return buildApiError('Enter a Booking ref or IS number')
  const qn = normalizeIsNumber(q)

  // 1. Ask AppleSystem for this IS number — confirmed first, then any status.
  let items: ASBookingListItem[]
  try {
    ;({ items } = await searchBookings({ isNumber: q, statuses: ['2'] }))
    if (!items.length) ({ items } = await searchBookings({ isNumber: q, statuses: [] }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not reach AppleSystem'
    return buildApiError(msg, 502)
  }
  if (!items.length) return buildApiError('not_found_anywhere', 404)

  // 2. Prefer an exact IS match, then a confirmed row, then the first row.
  const pick = items.find(it => refOf(it) === qn) ?? items.find(isConfirmed) ?? items[0]

  // 3. Import (idempotent). Fetch the quote template → map → persist.
  let bookingRef: string
  try {
    const quote = (await getQuoteTemplate(pick.quotation_no, String(pick.id ?? pick.reference_id))) as unknown as Record<string, unknown>
    const mapped = mapQuoteToBooking(quote, { fallbackIsNumber: pick.is_number ?? refOf(pick) })
    if (!mapped.operationCountry) return buildApiError('Could not determine the destination country from the IS number.', 422)

    const { booking } = await importMappedBooking(mapped, mapped.operationCountry, {
      createdById: await getAutomationUserId(),
      cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
    })
    bookingRef = booking.bookingRef
  } catch (err) {
    if (err instanceof AlreadyImportedError) {
      bookingRef = err.bookingRef // already imported between the miss and now — fine
    } else if (err instanceof ASMappingError) {
      return buildApiError(err.message, 422)
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      return buildApiError(`Failed to import from AppleSystem: ${msg}`, 500)
    }
  }

  // 4. Stamp the requesting handler (only if the field is empty) and log it.
  const created = await prisma.booking.findUnique({ where: { bookingRef }, select: FH_BOOKING_SELECT })
  if (created) {
    if (!created.fileHandler) {
      await prisma.booking.updateMany({
        where: { bookingRef, OR: [{ fileHandler: null }, { fileHandler: '' }] },
        data: { fileHandler: handler.name },
      })
    }
    await prisma.fileHandlerLog.create({
      data: {
        fileHandlerId: handler.id,
        fileHandlerName: handler.name,
        action: 'AS_IMPORTED',
        bookingId: created.id,
        bookingRef: created.bookingRef,
        isNumber: created.isNumber,
        cntlNumber: created.cntlNumber,
        operationCountry: created.operationCountry,
        details: `Auto-imported from AppleSystem via portal search "${q}"`,
      },
    })
  }

  return buildApiSuccess({ booking: created }, `Imported ${bookingRef} from AppleSystem`)
}
