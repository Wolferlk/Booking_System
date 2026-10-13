/**
 * POST /api/mobile/trips/[ref]/start  { portalShown?: boolean, portalSkipped?: boolean }
 *
 * The swipe that starts a trip, after the guest portal QR has been shown (or
 * skipped). Starting the first day is a separate call so the app can ask for
 * location first.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute, readJson } from '@/lib/mobile/http'
import { startTrip, tripProgress } from '@/lib/mobile/sessions'
import { requireTrip } from '../_trip'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('trip-start', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  const body = await readJson<{ portalShown?: boolean; portalSkipped?: boolean }>(req)
  await startTrip(actor.driverId, trip, { portalShown: !!body.portalShown, portalSkipped: !!body.portalSkipped })
  return buildApiSuccess({ progress: await tripProgress(actor.driverId, trip) })
})
