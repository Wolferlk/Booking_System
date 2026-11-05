/**
 * PATCH /api/mobile/vendor/trips/:assignmentId  { driverId?, vehicleId?, force? }
 *
 * Put a driver and vehicle on a trip — the movement, or the whole tour for Sri
 * Lanka. A same-day clash or a too-small vehicle answers 409 `confirm`; the app
 * asks, then sends again with `force`.
 */
import { buildApiSuccess } from '@/lib/utils'
import { requireVendor } from '@/lib/mobile/auth'
import { mobileRoute, readJson } from '@/lib/mobile/http'
import { assignJob, type AssignInput } from '@/lib/mobile/vendor'

export const dynamic = 'force-dynamic'

export const PATCH = mobileRoute<{ params: { id: string } }>('vendor-trip-assign', async (req, { params }) => {
  const v = await requireVendor(req)
  const r = await assignJob(v, params.id, await readJson<AssignInput>(req))
  return buildApiSuccess(r, r.wholeBooking ? 'Whole tour updated' : 'Trip updated')
})
