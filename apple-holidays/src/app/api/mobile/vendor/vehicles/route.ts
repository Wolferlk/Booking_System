/**
 * GET  /api/mobile/vendor/vehicles — the vendor's vehicles with their driver
 * POST /api/mobile/vendor/vehicles  { type, plateNo, brand?, model?, capacity, photoOutside?, photoInside?, driverId? }
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireVendor } from '@/lib/mobile/auth'
import { mobileRoute, readJson } from '@/lib/mobile/http'
import { VEHICLE_TYPES, createVehicle, listVehicles, type VehicleInput } from '@/lib/mobile/vendor'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('vendor-vehicles', async (req: NextRequest) =>
  buildApiSuccess({ vehicles: await listVehicles(await requireVendor(req)), types: VEHICLE_TYPES }))

export const POST = mobileRoute('vendor-vehicle-add', async (req: NextRequest) => {
  const v = await requireVendor(req)
  return buildApiSuccess(await createVehicle(v, await readJson<VehicleInput>(req)), 'Vehicle added')
})
