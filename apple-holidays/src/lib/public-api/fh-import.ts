/**
 * "Not in OPS yet? Pull it from AppleSystem." — the same rescue path the portal
 * offers when a search misses, expressed for the public API.
 *
 * Mirrors `/api/filehandler/bookings/import`: look the IS number up on
 * AppleSystem, map the confirmed quotation, import it with the automation user
 * as creator, then stamp the requesting file handler onto the new booking.
 */

import { prisma } from '@/lib/prisma'
import { getCancellationDeadline } from '@/lib/utils'
import { searchBookings as asSearchBookings, getQuoteTemplate, type ASBookingListItem } from '@/lib/applesystem'
import { normalizeIsNumber, mapQuoteToBooking, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId, AlreadyImportedError } from '@/lib/as-booking-import'
import { FhApiError } from './fh-http'
import { logFhAction, reloadBooking, resolveBooking, type FhBooking } from './fh-actions'
import type { FhCaller } from './fh-api-auth'

const isConfirmed = (it: ASBookingListItem) => it.status === '2' || it.status_class === 'confirm'

/** The normalised IS ref for an AppleSystem row (mirrors the staff search route). */
function refOf(it: ASBookingListItem): string | null {
  const own = (it.is_number ?? '').trim()
  const raw = own && own.toUpperCase() !== 'NA'
    ? own
    : it.reference_id_full?.find((r) => /^(IS|VN|SG|MY)/i.test(r))
  return raw ? normalizeIsNumber(raw) : null
}

export interface ImportResult {
  booking: FhBooking
  already_existed: boolean
  source: 'ops' | 'applesystem'
}

/**
 * Import `q` (an IS number or booking ref) from AppleSystem. Idempotent: if the
 * booking already exists in OPS it is returned untouched with
 * `already_existed: true`.
 */
export async function importFromAppleSystem(caller: FhCaller, q: string): Promise<ImportResult> {
  const raw = q.trim()
  if (!raw) throw new FhApiError('Enter a booking ref or IS number', 422, 'QUERY_REQUIRED')
  const qn = normalizeIsNumber(raw)

  const existing = await resolveBooking(raw)
  if (existing) return { booking: existing, already_existed: true, source: 'ops' }

  // 1. Ask AppleSystem for this IS number — confirmed first, then any status.
  let items: ASBookingListItem[]
  try {
    ;({ items } = await asSearchBookings({ isNumber: raw, statuses: ['2'] }))
    if (!items.length) ({ items } = await asSearchBookings({ isNumber: raw, statuses: [] }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not reach AppleSystem'
    throw new FhApiError(msg, 502, 'APPLESYSTEM_UNREACHABLE')
  }
  if (!items.length) {
    throw new FhApiError(`"${raw}" was not found in OPS or in AppleSystem`, 404, 'BOOKING_NOT_FOUND')
  }

  // 2. Prefer an exact IS match, then a confirmed row, then the first row.
  const pick = items.find((it) => refOf(it) === qn) ?? items.find(isConfirmed) ?? items[0]

  // 3. Import (idempotent). Fetch the quote template → map → persist.
  let bookingRef: string
  let alreadyExisted = false
  try {
    const quote = (await getQuoteTemplate(pick.quotation_no, String(pick.id ?? pick.reference_id))) as unknown as Record<string, unknown>
    const mapped = mapQuoteToBooking(quote, { fallbackIsNumber: pick.is_number ?? refOf(pick) })
    if (!mapped.operationCountry) {
      throw new FhApiError('Could not determine the destination country from the IS number', 422, 'COUNTRY_UNKNOWN')
    }

    const { booking } = await importMappedBooking(mapped, mapped.operationCountry, {
      createdById: await getAutomationUserId(),
      cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
    })
    bookingRef = booking.bookingRef
  } catch (err) {
    if (err instanceof AlreadyImportedError) {
      bookingRef = err.bookingRef // imported between the miss and now — fine
      alreadyExisted = true
    } else if (err instanceof ASMappingError) {
      throw new FhApiError(err.message, 422, 'MAPPING_FAILED')
    } else if (err instanceof FhApiError) {
      throw err
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      throw new FhApiError(`Failed to import from AppleSystem: ${msg}`, 502, 'IMPORT_FAILED')
    }
  }

  const created = await prisma.booking.findUnique({ where: { bookingRef }, select: { id: true } })
  if (!created) throw new FhApiError('Import succeeded but the booking could not be read back', 500, 'INTERNAL_ERROR')

  const booking = await reloadBooking(created.id)
  await logFhAction(caller, booking, 'AS_IMPORTED', `Auto-imported from AppleSystem via API search "${raw}"`)

  return { booking: await reloadBooking(created.id), already_existed: alreadyExisted, source: 'applesystem' }
}
