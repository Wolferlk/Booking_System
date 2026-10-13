/**
 * GET /api/mobile/trips/[ref]  — one trip, day by day, with the driver's
 * progress, the guest portal + feedback links (shown as QR codes) and whether
 * the guest has sent feedback yet.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { feedbackSubmitted, guestLinks, tripProgress } from '@/lib/mobile/sessions'
import { requireTrip } from './_trip'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('trip', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  const [progress, feedback] = await Promise.all([tripProgress(actor.driverId, trip), feedbackSubmitted(trip.bookingId)])
  return buildApiSuccess({ trip, progress, feedback, links: guestLinks(trip.bookingRef) })
})
