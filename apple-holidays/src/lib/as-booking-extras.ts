/**
 * AppleSystem fields the Booking table has no column for.
 *
 * The quote template carries a few things ops want on the booking page that the
 * `bookings` / `itinerary_items` tables cannot hold:
 *
 *   agentId      ← relevant_parties.agent_id      ("NL2200266119598")
 *   salesPerson  ← relevant_parties.sales_person  ("MMT")
 *   dayRoutes    ← itinerary[].route              ("Hanoi -> Da Nang( City Center)")
 *
 * They live in `system_settings` under `as_extras:<bookingRef>` as one JSON
 * blob — the same no-migration approach as `as_sync_state:` in
 * `as-booking-sync.ts`. Adding columns to `bookings` would break every booking
 * read on a database the ALTER has not been run on, and the live DB carries
 * drift and must not be pushed to.
 *
 * Every read and write here is best-effort: a failure is logged and never fails
 * the import or sync that called it.
 */

import { prisma } from '@/lib/prisma'
import type { MappedBookingInput } from '@/lib/as-booking-map'

export const AS_EXTRAS_PREFIX = 'as_extras:'

export interface AsDayRoute {
  dayNo: number
  date: string
  route: string
}

export interface AsBookingExtras {
  agentId: string | null
  salesPerson: string | null
  dayRoutes: AsDayRoute[]
  updatedAt: string
}

function keyOf(bookingRef: string) {
  return `${AS_EXTRAS_PREFIX}${bookingRef}`
}

export async function getAsExtras(bookingRef: string): Promise<AsBookingExtras | null> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: keyOf(bookingRef) } })
    if (!row) return null
    const v = JSON.parse(row.value) as Partial<AsBookingExtras>
    return {
      agentId: v.agentId ?? null,
      salesPerson: v.salesPerson ?? null,
      dayRoutes: Array.isArray(v.dayRoutes) ? v.dayRoutes : [],
      updatedAt: v.updatedAt ?? row.updatedAt.toISOString(),
    }
  } catch (err) {
    console.error('[as-extras] read failed:', err)
    return null
  }
}

/**
 * Store the extras from a freshly mapped quote. Same non-destructive rule as
 * the sync: an empty upstream value never blanks one already stored.
 */
export async function saveAsExtras(bookingRef: string, mapped: MappedBookingInput): Promise<void> {
  try {
    const prev = await getAsExtras(bookingRef)
    const next: AsBookingExtras = {
      agentId: mapped.agentId ?? prev?.agentId ?? null,
      salesPerson: mapped.salesPerson ?? prev?.salesPerson ?? null,
      dayRoutes: mapped.dayRoutes.length > 0 ? mapped.dayRoutes : prev?.dayRoutes ?? [],
      updatedAt: new Date().toISOString(),
    }
    const value = JSON.stringify(next)
    await prisma.systemSetting.upsert({
      where: { key: keyOf(bookingRef) },
      create: { key: keyOf(bookingRef), value },
      update: { value },
    })
  } catch (err) {
    console.error('[as-extras] write failed:', err)
  }
}

/**
 * The AppleSystem `quotation_no` behind a stored CNTL number. AS imports now
 * store `reference_numbers.control` ("499592CNTL"), and TC emails carry the same
 * shape ("471416CNTL" / "CNTL459773"), but the AS API itself wants the bare
 * digits.
 */
export function quotationNoFromCntl(cntl: string | null | undefined): string | null {
  const s = (cntl ?? '').trim()
  if (!s) return null
  return s.replace(/^CNTL\s*/i, '').replace(/\s*CNTL$/i, '').trim() || null
}

/** Every stored spelling a quotation number may have, for lookups. */
export function cntlCandidates(quotationNo: string): string[] {
  const bare = quotationNoFromCntl(quotationNo) ?? quotationNo.trim()
  return Array.from(new Set([quotationNo.trim(), bare, `${bare}CNTL`, `CNTL${bare}`]))
}
