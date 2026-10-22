/**
 * GET  /api/mobile/vendor/drivers — the vendor's drivers, with app status
 *                                   (on the app / code sent / not joined),
 *                                   who is driving now and their next trip
 * POST /api/mobile/vendor/drivers  { name, whatsapp, email?, licenseNo?, photoUrl?, vehicleId?, sendCode? }
 *
 * The WhatsApp number is the driver's sign-in: `sendCode` sends them a
 * 6-digit code there straight away.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireVendor } from '@/lib/mobile/auth'
import { mobileRoute, readJson } from '@/lib/mobile/http'
import { createDriver, listDrivers, type DriverInput } from '@/lib/mobile/vendor'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('vendor-drivers', async (req: NextRequest) => buildApiSuccess(await listDrivers(await requireVendor(req))))

export const POST = mobileRoute('vendor-driver-add', async (req: NextRequest) => {
  const v = await requireVendor(req)
  const r = await createDriver(v, await readJson<DriverInput>(req))
  return buildApiSuccess(r, 'Driver added')
})
