/**
 * The Driver-Auto open-trip board for a vehicle vendor, signed in.
 *
 *   GET  /api/mobile/vendor/open-trips
 *   POST /api/mobile/vendor/open-trips  { action: 'request', tripKey, note? } | { action: 'withdraw', claimId }
 *
 * The vendor requests for their fleet; once ops approves, the trip lands in
 * the vendor's Trips with no driver yet, and the vendor picks one.
 */
import { NextRequest } from 'next/server'
import { requireVendor } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { openTripAction, openTripBoard } from '@/lib/mobile/open-trips'
import { resolveParty } from '@/lib/driver-auto/server'

export const dynamic = 'force-dynamic'

async function party(req: NextRequest) {
  const actor = await requireVendor(req)
  const p = await resolveParty('VENDOR', actor.vendorId)
  if (!p) throw new MobileError('Vendor not found.', 404)
  return p
}

export const GET = mobileRoute('vendor-open-trips', async (req: NextRequest) => openTripBoard(await party(req)))

export const POST = mobileRoute('vendor-open-trips-action', async (req: NextRequest) => openTripAction(await party(req), await readJson(req)))
