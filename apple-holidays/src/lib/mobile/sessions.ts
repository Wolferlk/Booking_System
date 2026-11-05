/**
 * Driver App — running a trip.
 *
 *   start trip   portal QR shown (or skipped) → swipe → mobile_trip_sessions
 *   start day    swipe → mobile_trip_days row for today (location must be on)
 *   GPS          batches of points → km for the day (see geo.ts)
 *   pause        "Take a break" → mobile_trip_pauses row; the day stays STARTED,
 *                GPS keeps running, but km and minutes inside a pause are not
 *                driving (unless the driver says the guest was in the car)
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
import { randomUUID } from 'crypto'
import { isMobileTableMissing, MobileError } from './http'
import { accumulate, isValidPoint, MAX_ACCURACY_M, type Anchor, type GeoPoint } from './geo'
import { localTodayFor, type DriverTrip } from './trips'
import { notify, notifyStaff } from './notify'
import { isSandboxBookingId } from './sandbox'
import { requireTicketsUploaded } from './tickets'

export function guestLinks(bookingRef: string) {
  const base = appBaseUrl()
  return { portalUrl: `${base}${portalLinkPath(bookingRef)}`, feedbackUrl: `${base}${feedbackLinkPath(bookingRef)}` }
}

export async function sessionFor(driverId: string, bookingId: string) {
  return prisma.mobileTripSession.findUnique({ where: { driverId_bookingId: { driverId, bookingId } } })
}

export async function feedbackSubmitted(bookingId: string): Promise<{ submitted: boolean; at: string | null; overall: string | null }> {
  // Test trips have no guest — treat the form as in so the trip can be finished.
  if (isSandboxBookingId(bookingId)) return { submitted: true, at: new Date().toISOString(), overall: 'TEST' }
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
  const pauses = session ? await pausesOf(session.id) : []
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
      ...pauseSummary(d.id, d.status, pauses),
    })),
    /** The day that is running right now, if any. */
    activeDay: days.find(d => d.status === 'STARTED')?.dayDate ?? null,
  }
}

/** The driver's own feed (bell + push). Never blocks or fails the action. */
async function tellDriver(driverId: string, kind: string, title: string, body: string, bookingRef: string, dedupeKey?: string) {
  // Awaited by the callers: on serverless a floating promise can be frozen mid-send.
  await notify({ actorType: 'DRIVER', actorId: driverId, kind, title, body, data: { bookingRef, screen: 'trip' }, dedupeKey })
    .catch(err => console.error('[mobile tellDriver]', err))
}

const dayNoOf = (trip: DriverTrip, date: string) => trip.days.find(d => d.date === date)?.dayNo ?? null

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
  const created = await prisma.mobileTripSession.create({
    data: {
      driverId, bookingId: trip.bookingId, bookingRef: trip.bookingRef, country: trip.country,
      portalShownAt: opts.portalShown ? new Date() : null, portalSkipped: opts.portalSkipped,
    },
  })
  await tellDriver(driverId, 'TRIP_STARTED', `Trip started · ${trip.fileNo} 🚗`,
    `${trip.leadGuest ?? 'Guest'} · ${trip.days.length} day${trip.days.length === 1 ? '' : 's'}. Swipe "Start day" when you leave.`,
    trip.bookingRef, `trip-start:${created.id}`)
  return created
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
  const dayNo = dayNoOf(trip, today)
  const first = trip.days.find(d => d.date === today)?.movements.find(m => m.mine && !m.noDriverNeeded)
  await tellDriver(driverId, 'DAY_STARTED', `Day ${dayNo ?? ''} started · ${trip.fileNo}`.replace('Day  ', 'Day '),
    first ? `Next: ${first.time ? `${first.time} · ` : ''}${first.from ?? first.location}${first.to ? ` → ${first.to}` : ''}. Drive safe!` : 'Kilometres are counting. Drive safe!',
    trip.bookingRef, `day-start:${session.id}:${today}`)
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
  await closeOpenPauses({ dayId: day.id }, 'DAY_END')
  const ended = await prisma.mobileTripDay.update({
    where: { id: day.id },
    data: { status: 'ENDED', endedAt: new Date(), endLat: input.lat ?? day.lastLat, endLng: input.lng ?? day.lastLng, endOdometer: input.odometer ?? null },
  })
  await recomputeSessionKm(session.id)
  const dayNo = dayNoOf(trip, ended.dayDate)
  await tellDriver(driverId, 'DAY_ENDED', `Day ${dayNo ?? ended.dayDate} done · ${Number(ended.distanceKm).toFixed(1)} km`,
    trip.endDate <= ended.dayDate ? 'Last day — show the guest the feedback QR to finish the trip.' : 'Rest well! See you tomorrow.',
    trip.bookingRef)
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

  // The anchor's own time: the stored point it came from. None found = the
  // start-of-day position (untimed). The latest stored point, if it was not
  // the anchor, is a rejected "jump" the next point may confirm.
  let anchor: Anchor | null = null
  let pending: GeoPoint | null = null
  if (day.lastLat != null && day.lastLng != null) {
    const [at, latest] = day.pointCount > 0
      ? await Promise.all([
        prisma.mobileLocationPoint.findFirst({ where: { dayId: day.id, lat: day.lastLat, lng: day.lastLng, OR: [{ accuracy: null }, { accuracy: { lte: MAX_ACCURACY_M } }] }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true } }),
        prisma.mobileLocationPoint.findFirst({ where: { dayId: day.id }, orderBy: { recordedAt: 'desc' }, select: { lat: true, lng: true, accuracy: true, recordedAt: true } }),
      ])
      : [null, null]
    anchor = { lat: day.lastLat, lng: day.lastLng, t: at?.recordedAt.getTime() ?? null }
    if (latest && !(latest.lat === day.lastLat && latest.lng === day.lastLng)
      && (latest.accuracy == null || latest.accuracy <= MAX_ACCURACY_M)) {
      pending = { lat: latest.lat, lng: latest.lng, accuracy: latest.accuracy, t: latest.recordedAt.getTime() }
    }
  }
  // Split the batch into runs inside / outside a pause. The anchor carries
  // across, so the distance moved during a break is never counted at resume.
  const pauses = await prisma.mobileTripPause.findMany({
    where: { dayId: day.id, OR: [{ endT: null }, { endT: { gt: BigInt(Math.floor(points[0].t)) } }] },
    select: { id: true, startT: true, endT: true, countMoved: true },
  }).catch(() => [])
  const pauseAt = (t: number) => pauses.find(p => Number(p.startT) <= t && (p.endT == null || t < Number(p.endT))) ?? null
  let next = anchor
  let addM = 0
  const movedM = new Map<string, number>()
  for (let i = 0; i < points.length;) {
    const pz = pauseAt(points[i].t)
    let j = i + 1
    while (j < points.length && pauseAt(points[j].t) === pz) j++
    const r = accumulate(next, points.slice(i, j), pending)
    next = r.anchor
    pending = r.pending
    if (pz) movedM.set(pz.id, (movedM.get(pz.id) ?? 0) + r.addM)
    if (!pz || pz.countMoved) addM += r.addM
    i = j
  }
  for (const [id, m] of Array.from(movedM)) {
    if (m > 0) await prisma.mobileTripPause.update({ where: { id }, data: { movedKm: { increment: Number((m / 1000).toFixed(3)) } } })
  }
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
  await requireTicketsUploaded(driverId, trip)

  const fb = await feedbackSubmitted(trip.bookingId)
  if (!fb.submitted && session.feedbackStatus !== 'WAIVED') {
    throw new MobileError('Guest feedback is not in yet. Show the feedback QR to the guest.', 409, 'feedback_missing')
  }
  const done = await prisma.mobileTripSession.update({
    where: { id: session.id },
    data: { status: 'COMPLETED', completedAt: new Date(), feedbackStatus: fb.submitted ? 'SUBMITTED' : session.feedbackStatus },
  })
  await tellDriver(driverId, 'TRIP_DONE', `Trip finished · ${trip.fileNo} 🏆`,
    `${Number(done.totalKm).toFixed(0)} km driven. Thank you!`, trip.bookingRef, `trip-done-driver:${session.id}`)
  if (!isSandboxBookingId(trip.bookingId)) await notifyStaff(trip.country, {
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

// ── Breaks ─────────────────────────────────────────────────────────────────

export const PAUSE_REASONS = ['MEAL', 'FUEL', 'GUEST_STOP', 'REST', 'PRAYER', 'VEHICLE', 'PERSONAL', 'OTHER'] as const
export type PauseReason = (typeof PAUSE_REASONS)[number]

const PAUSE_SETUP = 'Breaks are not switched on for this server yet. Operations: run prisma/sql/apply-trip-pauses.sh.'

type PauseRow = Awaited<ReturnType<typeof prisma.mobileTripPause.findMany>>[number]

/** Every break on a session; [] while the table is not on this database yet. */
async function pausesOf(sessionId: string): Promise<PauseRow[]> {
  return prisma.mobileTripPause.findMany({ where: { sessionId }, orderBy: { startT: 'asc' } }).catch(() => [])
}

/** What the app needs about a day's breaks. Times are the phone's clock, which is what the app compares against. */
function pauseSummary(dayId: string, dayStatus: string, all: PauseRow[]) {
  const mine = all.filter(p => p.dayId === dayId)
  const open = dayStatus === 'STARTED' ? mine.find(p => p.endT == null) : undefined
  const closed = mine.filter(p => p.endT != null)
  return {
    pause: open ? {
      id: open.id, reason: open.reason, note: open.note, plannedMin: open.plannedMin,
      startedAt: new Date(Number(open.startT)).toISOString(), lat: open.lat, lng: open.lng,
    } : null,
    pausedMs: closed.reduce((s, p) => s + Math.max(0, Number(p.endT) - Number(p.startT)), 0),
    breaks: mine.map(p => ({
      reason: p.reason,
      startedAt: new Date(Number(p.startT)).toISOString(),
      endedAt: p.endT != null ? new Date(Number(p.endT)).toISOString() : null,
      movedKm: Math.round(Number(p.movedKm) * 10) / 10,
      countMoved: p.countMoved,
    })),
  }
}

/** The phone's clock when it is sane, else the server's. */
function phoneTime(t: number | null | undefined): number {
  const now = Date.now()
  return t != null && Number.isFinite(t) && Math.abs(t - now) < 24 * 3_600_000 ? Math.round(t) : now
}

export interface PauseInput {
  /** made on the phone, so a retried send is the same break */
  id?: string | null
  reason?: string | null
  note?: string | null
  plannedMin?: number | null
  /** phone clock, epoch ms */
  t?: number | null
  lat?: number | null
  lng?: number | null
  /** resume: the guest was in the car, so km moved during the break count */
  countMoved?: boolean
  /** resume: 'MOVING' when it came from the "you're moving" prompt */
  by?: string | null
}

export async function pauseDay(driverId: string, trip: DriverTrip, input: PauseInput) {
  const session = await sessionFor(driverId, trip.bookingId)
  if (!session) throw new MobileError('Start the trip first.', 409, 'no_session')
  const day = await prisma.mobileTripDay.findFirst({ where: { sessionId: session.id, status: 'STARTED' } })
  if (!day) throw new MobileError('No day is running.', 409, 'no_day')
  const id = input.id && /^[A-Za-z0-9_-]{8,64}$/.test(input.id) ? input.id : randomUUID()
  try {
    const same = await prisma.mobileTripPause.findUnique({ where: { id } })
    if (same) return same
    const open = await prisma.mobileTripPause.findFirst({ where: { dayId: day.id, endT: null } })
    if (open) return open
    const reason: PauseReason = PAUSE_REASONS.includes(input.reason as PauseReason) ? input.reason as PauseReason : 'OTHER'
    const planned = input.plannedMin != null && input.plannedMin > 0 ? Math.min(Math.round(input.plannedMin), 12 * 60) : null
    const created = await prisma.mobileTripPause.create({
      data: {
        id, dayId: day.id, sessionId: session.id, driverId, bookingRef: trip.bookingRef,
        reason, note: input.note?.trim().slice(0, 500) || null, plannedMin: planned,
        startT: BigInt(phoneTime(input.t)), lat: input.lat ?? day.lastLat, lng: input.lng ?? day.lastLng,
      },
    })
    // A vehicle problem is something ops act on now, not on the next board refresh.
    if (reason === 'VEHICLE' && !isSandboxBookingId(trip.bookingId)) {
      await notifyStaff(trip.country, {
        kind: 'VEHICLE_ISSUE',
        title: `Vehicle problem · ${trip.fileNo}`,
        body: `${trip.leadGuest ?? 'Guest'} — the driver paused the day${created.note ? `: ${created.note}` : '.'}`,
        data: { bookingRef: trip.bookingRef },
        dedupeKey: `vehicle-issue:${created.id}`,
      }).catch(err => console.error('[mobile pause notify]', err))
    }
    return created
  } catch (err) {
    if (isMobileTableMissing(err)) throw new MobileError(PAUSE_SETUP, 503, 'setup_required')
    throw err
  }
}

/** Ends the open break. Already resumed (or the day was ended) = nothing to do. */
export async function resumeDay(driverId: string, trip: DriverTrip, input: PauseInput) {
  const session = await sessionFor(driverId, trip.bookingId)
  if (!session) throw new MobileError('Start the trip first.', 409, 'no_session')
  try {
    const open = await prisma.mobileTripPause.findFirst({ where: { sessionId: session.id, endT: null } })
    if (!open) return null
    const endT = Math.max(phoneTime(input.t), Number(open.startT))
    const ended = await prisma.mobileTripPause.update({
      where: { id: open.id },
      data: {
        endT: BigInt(endT), endedAt: new Date(), endLat: input.lat ?? null, endLng: input.lng ?? null,
        endedBy: input.by === 'MOVING' ? 'MOVING' : 'DRIVER', countMoved: !!input.countMoved,
      },
    })
    // Guest was in the car: what was moved so far goes onto the day now; any
    // later-arriving points of the break count as they come in (ingestPoints).
    if (ended.countMoved && Number(ended.movedKm) > 0) {
      await prisma.mobileTripDay.update({ where: { id: ended.dayId }, data: { distanceKm: { increment: Number(ended.movedKm) } } })
      await recomputeSessionKm(session.id)
    }
    return ended
  } catch (err) {
    if (isMobileTableMissing(err)) throw new MobileError(PAUSE_SETUP, 503, 'setup_required')
    throw err
  }
}

/** Day ended (by the driver or by ops) while on a break. */
export async function closeOpenPauses(where: { dayId?: string; sessionId?: string }, by: 'DAY_END' | 'OPS') {
  const now = Date.now()
  const open = await prisma.mobileTripPause.findMany({ where: { ...where, endT: null } }).catch(() => [])
  for (const p of open) {
    await prisma.mobileTripPause.update({
      where: { id: p.id },
      data: { endT: BigInt(Math.max(now, Number(p.startT))), endedAt: new Date(), endedBy: by },
    })
  }
}
