/**
 * Driver App — running a trip.
 *
 *   start trip   portal QR shown (or skipped) → swipe → mobile_trip_sessions
 *   start day    swipe → mobile_trip_days row for today (location must be on)
 *   GPS          batches of points → km for the day (see geo.ts)
 *   end day      swipe → day closed, km rolled into the session total
 *   finish trip  only once the guest feedback form for the booking exists
 *                (guest_feedback_forms, the same form the WhatsApp link opens)
 *                or ops waived it
 *
 * Writes only to the mobile_* tables. Reads bookings / feedback as they are.
 */
import { prisma } from '@/lib/prisma'
import { feedbackLinkPath } from '@/lib/feedback-link'
import { portalLinkPath } from '@/lib/portal-link'
import { appBaseUrl } from '@/lib/driver-auto/server'
import { MobileError } from './http'
import { accumulate, isValidPoint, type GeoPoint } from './geo'
import { localTodayFor, type DriverTrip } from './trips'
import { notifyStaff } from './notify'

export function guestLinks(bookingRef: string) {
  const base = appBaseUrl()
  return { portalUrl: `${base}${portalLinkPath(bookingRef)}`, feedbackUrl: `${base}${feedbackLinkPath(bookingRef)}` }
}

export async function sessionFor(driverId: string, bookingId: string) {
  return prisma.mobileTripSession.findUnique({ where: { driverId_bookingId: { driverId, bookingId } } })
}

export async function feedbackSubmitted(bookingId: string): Promise<{ submitted: boolean; at: string | null; overall: string | null }> {
  const f = await prisma.guestFeedbackForm.findUnique({
    where: { bookingId }, select: { submittedAt: true, overallExperience: true },
  })
  return { submitted: !!f, at: f?.submittedAt.toISOString() ?? null, overall: f?.overallExperience ?? null }
}

export async function tripProgress(driverId: string, trip: DriverTrip) {
  const session = await sessionFor(driverId, trip.bookingId)
  const days = session
    ? await prisma.mobileTripDay.findMany({ where: { sessionId: session.id }, orderBy: { dayDate: 'asc' } })
    : []
  const today = localTodayFor(trip.country)
  return {
    today,
    session: session && {
      id: session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      portalSkipped: session.portalSkipped,
      feedbackStatus: session.feedbackStatus,
      completedAt: session.completedAt?.toISOString() ?? null,
      totalKm: Number(session.totalKm),
    },
    days: days.map(d => ({
      id: d.id,
      date: d.dayDate,
      status: d.status,
      startedAt: d.startedAt.toISOString(),
      endedAt: d.endedAt?.toISOString() ?? null,
      km: Number(d.distanceKm),
      startOdometer: d.startOdometer,
      endOdometer: d.endOdometer,
    })),
    /** The day that is running right now, if any. */
    activeDay: days.find(d => d.status === 'STARTED')?.dayDate ?? null,
  }
}

export async function startTrip(driverId: string, trip: DriverTrip, opts: { portalShown: boolean; portalSkipped: boolean }) {
  const existing = await sessionFor(driverId, trip.bookingId)
  if (existing) {
    if (existing.status === 'COMPLETED') throw new MobileError('This trip is already finished.', 409, 'completed')
    if (existing.status === 'HANDED_OVER') {
      return prisma.mobileTripSession.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
    }
    return existing
  }
  const today = localTodayFor(trip.country)
  if (today < trip.startDate) {
    throw new MobileError(`This trip starts on ${trip.startDate}. You can start it on that day.`, 409, 'too_early')
  }
  return prisma.mobileTripSession.create({
    data: {
      driverId, bookingId: trip.bookingId, bookingRef: trip.bookingRef, country: trip.country,
      portalShownAt: opts.portalShown ? new Date() : null, portalSkipped: opts.portalSkipped,
    },
  })
}

export interface DayActionInput {
  lat?: number | null
  lng?: number | null
  odometer?: number | null
}

export async function startDay(driverId: string, trip: DriverTrip, input: DayActionInput) {
  const session = await sessionFor(driverId, trip.bookingId)
  if (!session || session.status !== 'ACTIVE') throw new MobileError('Start the trip first.', 409, 'no_session')
  const today = localTodayFor(trip.country)

  // Only one running day across all trips — a driver drives one car.
  const running = await prisma.mobileTripDay.findFirst({ where: { driverId, status: 'STARTED' } })
  if (running && !(running.sessionId === session.id && running.dayDate === today)) {
    throw new MobileError(`Day ${running.dayDate} on ${running.bookingRef} is still running. End it first.`, 409, 'day_running')
  }
  const existing = await prisma.mobileTripDay.findUnique({ where: { sessionId_dayDate: { sessionId: session.id, dayDate: today } } })
  if (existing?.status === 'STARTED') return existing
  if (existing?.status === 'ENDED') {
    // Re-opening the same day keeps counting onto it (e.g. ended by mistake).
    return prisma.mobileTripDay.update({ where: { id: existing.id }, data: { status: 'STARTED', endedAt: null } })
  }
  return prisma.mobileTripDay.create({
    data: {
      sessionId: session.id, driverId, bookingRef: trip.bookingRef, dayDate: today,
      startLat: input.lat ?? null, startLng: input.lng ?? null,
      // The start position anchors the first hop. lastPingAt stays empty so the
      // phone's own timestamps decide which points are new (its clock may differ).
      lastLat: input.lat ?? null, lastLng: input.lng ?? null,
      startOdometer: input.odometer ?? null,
    },
  })
}

export async function endDay(driverId: string, trip: DriverTrip, input: DayActionInput) {
  const session = await sessionFor(driverId, trip.bookingId)
  if (!session) throw new MobileError('Start the trip first.', 409, 'no_session')
  const day = await prisma.mobileTripDay.findFirst({ where: { sessionId: session.id, status: 'STARTED' } })
  if (!day) throw new MobileError('No day is running.', 409, 'no_day')
  if (input.odometer != null && day.startOdometer != null && input.odometer < day.startOdometer) {
    throw new MobileError('The end odometer is lower than the start. Please check it.', 400, 'odometer')
  }
  const ended = await prisma.mobileTripDay.update({
    where: { id: day.id },
    data: { status: 'ENDED', endedAt: new Date(), endLat: input.lat ?? day.lastLat, endLng: input.lng ?? day.lastLng, endOdometer: input.odometer ?? null },
  })
  await recomputeSessionKm(session.id)
  return ended
}

async function recomputeSessionKm(sessionId: string) {
  const agg = await prisma.mobileTripDay.aggregate({ where: { sessionId }, _sum: { distanceKm: true } })
  await prisma.mobileTripSession.update({ where: { id: sessionId }, data: { totalKm: Number(agg._sum.distanceKm ?? 0).toFixed(2) } })
}

/**
 * Store a batch of GPS points on the running day and add the filtered
 * distance. Idempotent enough for retries: points not newer than the day's
 * last ping are dropped, so an offline queue re-sent twice does not double km.
 */
export async function ingestPoints(driverId: string, raw: unknown[]): Promise<{ accepted: number; dayKm: number | null }> {
  const day = await prisma.mobileTripDay.findFirst({ where: { driverId, status: 'STARTED' } })
  if (!day) return { accepted: 0, dayKm: null }

  const since = day.lastPingAt?.getTime() ?? 0
  const points: GeoPoint[] = (raw as Record<string, unknown>[])
    .slice(0, 500)
    .map(p => ({
      lat: Number(p.lat), lng: Number(p.lng),
      accuracy: p.accuracy == null ? null : Number(p.accuracy),
      speed: p.speed == null ? null : Number(p.speed),
      t: Number(p.t),
    }))
    .filter(p => isValidPoint(p) && p.t > since && p.t <= Date.now() + 60_000)
    .sort((a, b) => a.t - b.t)
  if (!points.length) return { accepted: 0, dayKm: Number(day.distanceKm) }

  const anchor = day.lastLat != null && day.lastLng != null ? { lat: day.lastLat, lng: day.lastLng, t: since || points[0].t } : null
  const { addM, anchor: next } = accumulate(anchor, points)
  const last = points[points.length - 1]

  await prisma.mobileLocationPoint.createMany({
    data: points.map(p => ({
      dayId: day.id, lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, speed: p.speed ?? null, recordedAt: new Date(p.t),
    })),
  })
  const km = Number(day.distanceKm) + addM / 1000
  await prisma.mobileTripDay.update({
    where: { id: day.id },
    data: {
      distanceKm: km.toFixed(3),
      pointCount: { increment: points.length },
      // The anchor only moves on a hop that counted; lastPingAt always moves.
      lastLat: next?.lat ?? day.lastLat, lastLng: next?.lng ?? day.lastLng,
      lastSpeed: last.speed ?? null,
      lastPingAt: new Date(last.t),
    },
  })
  if (addM > 0) await recomputeSessionKm(day.sessionId)
  return { accepted: points.length, dayKm: Math.round(km * 10) / 10 }
}

export async function completeTrip(driverId: string, trip: DriverTrip) {
  const session = await sessionFor(driverId, trip.bookingId)
  if (!session) throw new MobileError('This trip was never started.', 409, 'no_session')
  if (session.status === 'COMPLETED') return session
  const running = await prisma.mobileTripDay.findFirst({ where: { sessionId: session.id, status: 'STARTED' } })
  if (running) throw new MobileError('End today first, then finish the trip.', 409, 'day_running')

  const fb = await feedbackSubmitted(trip.bookingId)
  if (!fb.submitted && session.feedbackStatus !== 'WAIVED') {
    throw new MobileError('Guest feedback is not in yet. Show the feedback QR to the guest.', 409, 'feedback_missing')
  }
  const done = await prisma.mobileTripSession.update({
    where: { id: session.id },
    data: { status: 'COMPLETED', completedAt: new Date(), feedbackStatus: fb.submitted ? 'SUBMITTED' : session.feedbackStatus },
  })
  await notifyStaff(trip.country, {
    kind: 'TRIP_COMPLETED',
    title: `Trip finished · ${trip.fileNo}`,
    body: `${trip.leadGuest ?? 'Guest'} — ${Number(done.totalKm).toFixed(0)} km driven.`,
    data: { bookingRef: trip.bookingRef },
    dedupeKey: `trip-done:${session.id}`,
  }).catch(err => console.error('[mobile completeTrip notify]', err))
  return done
}

export async function markFeedbackShown(driverId: string, bookingId: string) {
  const s = await sessionFor(driverId, bookingId)
  if (s && !s.feedbackShownAt) await prisma.mobileTripSession.update({ where: { id: s.id }, data: { feedbackShownAt: new Date() } })
}
