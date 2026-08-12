import { NextRequest } from 'next/server'
import type { HotelConfirmStatus } from '@prisma/client'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { assertBookingInScope, bookingRefFromStayKey, guardPrecheck } from '@/lib/precheck-guard'
import { linkStayToHotel, updateReconfirmation, type ReconfirmPatch } from '@/lib/hotel-precheck-write'

export const dynamic = 'force-dynamic'

const STATUSES: HotelConfirmStatus[] = [
  'PENDING', 'IN_PROGRESS', 'CONFIRMED', 'DISCREPANCY', 'ISSUE', 'CANCELLED', 'NOT_REQUIRED',
]
const CHANNELS = ['WHATSAPP', 'CALL', 'EMAIL', 'PORTAL', 'OTHER']

/** Parse an optional integer field, rejecting nonsense rather than coercing it. */
function intOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 999) throw new Error(`Invalid count: ${String(v)}`)
  return Math.floor(n)
}

function dateOrNull(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(v)}`)
  return d
}

function strOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * POST /api/precheck/stay — record reconfirmation progress on one hotel stay.
 *
 * The stay is addressed by `stayKey`; the reconfirmation row is created on
 * first write. Room, pax and date defaults are seeded server-side from the
 * live booking, so this endpoint only ever applies the fields the user
 * actually changed — a stale tab cannot overwrite an amendment.
 */
export async function POST(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const stayKey = String(body.stayKey ?? '').trim()
  if (!stayKey || !stayKey.includes('::')) return buildApiError('A valid stayKey is required')

  const bookingRef = bookingRefFromStayKey(stayKey)
  if (!(await assertBookingInScope(bookingRef, session))) {
    return buildApiError('Forbidden — this booking is outside your country scope', 403)
  }

  try {
    // ── Optional hotel (un)link, applied before the field patch so the
    // returned record already reflects the new hotel.
    if (body.hotelProfileId !== undefined) {
      const id = body.hotelProfileId === null ? null : String(body.hotelProfileId)
      await linkStayToHotel(stayKey, id, session.actor)
    }

    const status = body.status === undefined ? undefined : String(body.status) as HotelConfirmStatus
    if (status !== undefined && !STATUSES.includes(status)) {
      return buildApiError(`Unknown status "${status}"`)
    }

    const channel = strOrNull(body.lastChannel)
    if (channel && !CHANNELS.includes(channel)) {
      return buildApiError(`Unknown channel "${channel}"`)
    }

    const patch: ReconfirmPatch = {
      status,
      confirmationNumber: strOrNull(body.confirmationNumber),
      roomType:           strOrNull(body.roomType),
      roomCategory:       strOrNull(body.roomCategory),
      mealType:           strOrNull(body.mealType),
      roomCount:          intOrNull(body.roomCount),
      adults:             intOrNull(body.adults),
      children:           intOrNull(body.children),
      cwb:                intOrNull(body.cwb),
      cnb:                intOrNull(body.cnb),
      infants:            intOrNull(body.infants),
      lastChannel:        channel,
      dueAtOverride:      dateOrNull(body.dueAtOverride),
      followUpAt:         dateOrNull(body.followUpAt),
      discrepancyNote:    strOrNull(body.discrepancyNote),
      notes:              strOrNull(body.notes),
      eventNote:          strOrNull(body.eventNote),
      markChecked:        body.markChecked === true,
    }

    const updated = await updateReconfirmation(stayKey, patch, session.actor)
    return buildApiSuccess(updated, 'Saved')
  } catch (e) {
    console.error('[precheck/stay]', e)
    return buildApiError((e as Error).message, 400)
  }
}
