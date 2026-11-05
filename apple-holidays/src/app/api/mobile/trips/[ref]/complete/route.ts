/**
 * POST /api/mobile/trips/[ref]/complete  — finish the trip. Refused (409
 * 'feedback_missing') until the guest feedback form is in or ops waived it.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { completeTrip, tripProgress } from '@/lib/mobile/sessions'
import { requireTrip } from '../_trip'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('trip-complete', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  await completeTrip(actor.driverId, trip)
  return buildApiSuccess({ progress: await tripProgress(actor.driverId, trip) })
})
