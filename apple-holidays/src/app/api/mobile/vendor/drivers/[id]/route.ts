/**
 * PATCH /api/mobile/vendor/drivers/:id  { name?, whatsapp?, email?, licenseNo?, photoUrl?, vehicleId?, isActive? }
 * POST  /api/mobile/vendor/drivers/:id  { action: 'send-code' } — WhatsApp sign-in code
 *
 * Drivers are switched off, never deleted (their trips and payments keep the row).
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireVendor } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { sendDriverCode, updateDriver, type DriverInput } from '@/lib/mobile/vendor'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export const PATCH = mobileRoute<Ctx>('vendor-driver-update', async (req, { params }) => {
  const v = await requireVendor(req)
  return buildApiSuccess(await updateDriver(v, params.id, await readJson<DriverInput>(req)), 'Saved')
})

export const POST = mobileRoute<Ctx>('vendor-driver-action', async (req: NextRequest, { params }) => {
  const v = await requireVendor(req)
  const body = await readJson<{ action?: string }>(req)
  if (body.action !== 'send-code') throw new MobileError('Unknown action')
  const r = await sendDriverCode(v, params.id)
  if (!r.sent) throw new MobileError(r.error ?? 'The code could not be sent.', 502, 'send_failed')
  return buildApiSuccess(r, `Code sent to ${r.to}`)
})
