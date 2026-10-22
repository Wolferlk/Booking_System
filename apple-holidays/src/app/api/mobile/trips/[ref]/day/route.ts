/**
 * POST /api/mobile/trips/[ref]/day  { action: 'start' | 'end', lat?, lng?, odometer? }
 *                                   { action: 'pause', id, reason, note?, plannedMin?, t, lat?, lng? }
 *                                   { action: 'resume', t, lat?, lng?, countMoved?, by? }
 *
 * Start / end today's driving. The app only calls 'start' once location is on;
 * km for the day come from the GPS points posted to /api/mobile/locations.
 * Pause / resume mark a break inside the running day (see sessions.ts); the
 * app queues them offline and always sends them before the GPS points.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { endDay, pauseDay, resumeDay, startDay, tripProgress } from '@/lib/mobile/sessions'
import { requireTrip } from '../_trip'

export const dynamic = 'force-dynamic'

function num(v: unknown): number | null {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? null : n
}

export const POST = mobileRoute('trip-day', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  const body = await readJson<{
    action?: string; lat?: unknown; lng?: unknown; odometer?: unknown
    id?: unknown; reason?: unknown; note?: unknown; plannedMin?: unknown; t?: unknown; countMoved?: unknown; by?: unknown
  }>(req)
  const input = { lat: num(body.lat), lng: num(body.lng), odometer: num(body.odometer) == null ? null : Math.round(num(body.odometer)!) }
  const pause = {
    lat: input.lat, lng: input.lng, t: num(body.t), plannedMin: num(body.plannedMin),
    id: typeof body.id === 'string' ? body.id : null,
    reason: typeof body.reason === 'string' ? body.reason : null,
    note: typeof body.note === 'string' ? body.note : null,
    by: typeof body.by === 'string' ? body.by : null,
    countMoved: body.countMoved === true,
  }
  if (body.action === 'start') await startDay(actor.driverId, trip, input)
  else if (body.action === 'end') await endDay(actor.driverId, trip, input)
  else if (body.action === 'pause') await pauseDay(actor.driverId, trip, pause)
  else if (body.action === 'resume') await resumeDay(actor.driverId, trip, pause)
  else throw new MobileError("action must be 'start', 'end', 'pause' or 'resume'")
  return buildApiSuccess({ progress: await tripProgress(actor.driverId, trip) })
})
