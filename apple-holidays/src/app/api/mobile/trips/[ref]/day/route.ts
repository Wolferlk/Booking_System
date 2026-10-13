/**
 * POST /api/mobile/trips/[ref]/day  { action: 'start' | 'end', lat?, lng?, odometer? }
 *
 * Start / end today's driving. The app only calls 'start' once location is on;
 * km for the day come from the GPS points posted to /api/mobile/locations.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { endDay, startDay, tripProgress } from '@/lib/mobile/sessions'
import { requireTrip } from '../_trip'

export const dynamic = 'force-dynamic'

function num(v: unknown): number | null {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? null : n
}

export const POST = mobileRoute('trip-day', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  const body = await readJson<{ action?: string; lat?: unknown; lng?: unknown; odometer?: unknown }>(req)
  const input = { lat: num(body.lat), lng: num(body.lng), odometer: num(body.odometer) == null ? null : Math.round(num(body.odometer)!) }
  if (body.action === 'start') await startDay(actor.driverId, trip, input)
  else if (body.action === 'end') await endDay(actor.driverId, trip, input)
  else throw new MobileError("action must be 'start' or 'end'")
  return buildApiSuccess({ progress: await tripProgress(actor.driverId, trip) })
})
