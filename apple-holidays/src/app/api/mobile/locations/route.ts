/**
 * POST /api/mobile/locations  { points: [{ lat, lng, accuracy?, speed?, t }] }
 *
 * GPS breadcrumbs from the phone (foreground watcher or background task),
 * batched and retried by the app when offline. Points land on the driver's
 * running day; with no day running they are dropped.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute, readJson } from '@/lib/mobile/http'
import { ingestPoints } from '@/lib/mobile/sessions'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('locations', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const body = await readJson<{ points?: unknown[] }>(req)
  const result = await ingestPoints(actor.driverId, Array.isArray(body.points) ? body.points : [])
  return buildApiSuccess(result)
})
