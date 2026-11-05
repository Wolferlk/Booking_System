/**
 * PATCH /api/mobile/vendor/vehicles/:id  { type?, plateNo?, brand?, model?, capacity?, photoOutside?, photoInside?, driverId?, isActive? }
 *
 * Vehicles are switched off, never deleted; switching one off frees its driver.
 */
import { buildApiSuccess } from '@/lib/utils'
import { requireVendor } from '@/lib/mobile/auth'
import { mobileRoute, readJson } from '@/lib/mobile/http'
import { updateVehicle, type VehicleInput } from '@/lib/mobile/vendor'

export const dynamic = 'force-dynamic'

export const PATCH = mobileRoute<{ params: { id: string } }>('vendor-vehicle-update', async (req, { params }) => {
  const v = await requireVendor(req)
  return buildApiSuccess(await updateVehicle(v, params.id, await readJson<VehicleInput>(req)), 'Saved')
})
