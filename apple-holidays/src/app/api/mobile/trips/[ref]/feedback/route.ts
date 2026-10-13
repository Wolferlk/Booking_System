/**
 * GET  /api/mobile/trips/[ref]/feedback  — has the guest sent the feedback form? (polled while the QR is up)
 * POST /api/mobile/trips/[ref]/feedback  — the feedback QR was put on screen
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { feedbackSubmitted, guestLinks, markFeedbackShown, sessionFor } from '@/lib/mobile/sessions'
import { requireTrip } from '../_trip'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('trip-feedback', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  const [fb, session] = await Promise.all([feedbackSubmitted(trip.bookingId), sessionFor(actor.driverId, trip.bookingId)])
  return buildApiSuccess({ ...fb, waived: session?.feedbackStatus === 'WAIVED', feedbackUrl: guestLinks(trip.bookingRef).feedbackUrl })
})

export const POST = mobileRoute('trip-feedback-shown', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  await markFeedbackShown(actor.driverId, trip.bookingId)
  return buildApiSuccess({ ok: true })
})
