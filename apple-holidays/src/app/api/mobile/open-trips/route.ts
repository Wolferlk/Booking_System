/**
 * Driver-Auto inside the app — the same open-trip board a driver gets as a
 * WhatsApp link (/driver-board), signed in instead of link-gated.
 *
 *   GET  /api/mobile/open-trips
 *   POST /api/mobile/open-trips  { action: 'request', tripKey, note? } | { action: 'withdraw', claimId }
 *
 * Board and rules live in lib/mobile/open-trips.ts (shared with the vendor
 * side, /api/mobile/vendor/open-trips). A vendor's own driver gets
 * `vendorManaged: true` and no trips.
 */
import { NextRequest } from 'next/server'
import { requireDriver } from '@/lib/mobile/auth'
import { refuseForSandbox } from '@/lib/mobile/sandbox'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { openTripAction, openTripBoard } from '@/lib/mobile/open-trips'
import { resolveParty } from '@/lib/driver-auto/server'

export const dynamic = 'force-dynamic'

async function party(req: NextRequest) {
  const actor = await requireDriver(req)
  const p = await resolveParty('DRIVER', actor.driverId)
  if (!p) throw new MobileError('Driver not found.', 404)
  return p
}

export const GET = mobileRoute('open-trips', async (req: NextRequest) => openTripBoard(await party(req)))

export const POST = mobileRoute('open-trips-action', async (req: NextRequest) => {
  const p = await party(req)
  await refuseForSandbox(p.id, 'claiming an open trip')
  return openTripAction(p, await readJson(req))
})
