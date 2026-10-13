/**
 * Driver App — the operations side, shared by the staff view in the app
 * (`/api/mobile/staff/*`) and the web page (`/dashboard/driver-app`, through
 * `/api/driver-app/*`).
 *
 *   liveBoard        who is driving right now, km today, last position, and
 *                    today's assigned drivers who have not started yet
 *   listRequests     hand-overs, help calls, profile changes, feedback waivers
 *   decideRequest    approve / reject — the ONLY place a driver's request
 *                    reaches the existing `drivers` table (profile changes)
 *   decideVehicleCheck  approve / reject the 2-monthly photos; approval copies
 *                    the front / inside photos onto the vehicle record
 *
 * Every write to an existing table here is a person's explicit approval of
 * one row, and touches only the named fields of that row.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PROFILE_FIELDS } from './profile'
import { localTodayFor } from './trips'
import { notify } from './notify'
import { MobileError } from './http'

export interface OpsViewer {
  name: string
  /** null = all countries */
  country: string | null
}

export function viewerCountry(role: string, country: string): string | null {
  return role === 'ULTRA_SUPER_ADMIN' || country === 'ALL' ? null : country
}

async function driverMap(ids: string[]) {
  const rows = ids.length
    ? await prisma.driver.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, phone: true, country: true, photoUrl: true, vehicle: { select: { plateNo: true, type: true } } },
      })
    : []
  return new Map(rows.map(r => [r.id, r]))
}

export async function liveBoard(viewer: OpsViewer) {
  const today = localTodayFor(viewer.country ?? 'SRILANKA')
  const yesterday = new Date(Date.now() - 36 * 3_600_000)
  const days = await prisma.mobileTripDay.findMany({
    where: { OR: [{ status: 'STARTED' }, { dayDate: today }], startedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    orderBy: { startedAt: 'desc' },
    take: 300,
  })
  const sessions = await prisma.mobileTripSession.findMany({
    where: { id: { in: Array.from(new Set(days.map(d => d.sessionId))) } },
    select: { id: true, country: true, bookingRef: true, totalKm: true, status: true, feedbackStatus: true },
  })
  const sById = new Map(sessions.map(s => [s.id, s]))
  const drivers = await driverMap(Array.from(new Set(days.map(d => d.driverId))))

  const rows = days
    .map(d => {
      const s = sById.get(d.sessionId)
      const drv = drivers.get(d.driverId)
      const country = s?.country ?? drv?.country ?? null
      return {
        dayId: d.id,
        driverId: d.driverId,
        driverName: drv?.name ?? 'Driver',
        driverPhone: drv?.phone ?? null,
        photoUrl: drv?.photoUrl ?? null,
        vehicle: drv?.vehicle ? `${drv.vehicle.type} · ${drv.vehicle.plateNo}` : null,
        bookingRef: d.bookingRef,
        country,
        dayDate: d.dayDate,
        status: d.status,
        startedAt: d.startedAt.toISOString(),
        endedAt: d.endedAt?.toISOString() ?? null,
        km: Math.round(Number(d.distanceKm) * 10) / 10,
        tripKm: Math.round(Number(s?.totalKm ?? 0)),
        lastLat: d.lastLat,
        lastLng: d.lastLng,
        lastSpeedKmh: d.lastSpeed != null && d.lastSpeed >= 0 ? Math.round(d.lastSpeed * 3.6) : null,
        lastPingAt: d.lastPingAt?.toISOString() ?? null,
        /** No GPS for 20 min on a running day — phone off, app killed, or no signal. */
        silent: d.status === 'STARTED' && (!d.lastPingAt || Date.now() - d.lastPingAt.getTime() > 20 * 60_000),
        stale: d.status === 'STARTED' && d.startedAt < yesterday,
      }
    })
    .filter(r => !viewer.country || !r.country || r.country === viewer.country)

  // Drivers with a movement today who have not swiped "start day" in the app.
  const dayStart = new Date(`${today}T00:00:00.000Z`)
  const dayEnd = new Date(`${today}T23:59:59.999Z`)
  const assigned = await prisma.assignment.findMany({
    where: {
      driverId: { not: null },
      agendaItem: {
        date: { gte: dayStart, lte: dayEnd },
        agenda: { booking: { status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION', 'AMENDED', 'DRAFT'] }, ...(viewer.country ? { operationCountry: viewer.country as never } : {}) } },
      },
    },
    select: { driverId: true, agendaItem: { select: { meetingTime: true, timeFrom: true, agenda: { select: { booking: { select: { bookingRef: true } } } } } } },
    take: 500,
  })
  const startedToday = new Set(rows.filter(r => r.dayDate === today).map(r => r.driverId))
  const appUsers = new Set(
    (await prisma.mobileDriverAccount.findMany({ where: { driverId: { in: assigned.map(a => a.driverId!) } }, select: { driverId: true } }))
      .map(a => a.driverId),
  )
  const waitingMap = new Map<string, { driverId: string; bookingRef: string; firstTime: string | null; usesApp: boolean }>()
  for (const a of assigned) {
    const id = a.driverId!
    if (startedToday.has(id)) continue
    const t = a.agendaItem.meetingTime || a.agendaItem.timeFrom || null
    const prev = waitingMap.get(id)
    if (!prev || (t && (!prev.firstTime || t < prev.firstTime))) {
      waitingMap.set(id, { driverId: id, bookingRef: a.agendaItem.agenda.booking.bookingRef, firstTime: t, usesApp: appUsers.has(id) })
    }
  }
  const waitDrivers = await driverMap(Array.from(waitingMap.keys()))
  const notStarted = Array.from(waitingMap.values())
    .map(w => ({ ...w, driverName: waitDrivers.get(w.driverId)?.name ?? 'Driver', driverPhone: waitDrivers.get(w.driverId)?.phone ?? null }))
    .sort((a, b) => (a.firstTime ?? '99').localeCompare(b.firstTime ?? '99'))

  const pendingRequests = await prisma.mobileDriverRequest.count({ where: { status: 'PENDING' } })
  const pendingChecks = await prisma.mobileVehicleCheck.count({ where: { status: 'SUBMITTED' } })
  const appDrivers = await prisma.mobileDriverAccount.count({ where: { passwordHash: { not: null } } })

  return {
    today,
    driving: rows.filter(r => r.status === 'STARTED'),
    finishedToday: rows.filter(r => r.status === 'ENDED' && r.dayDate === today),
    notStarted,
    totals: {
      driving: rows.filter(r => r.status === 'STARTED').length,
      kmToday: Math.round(rows.filter(r => r.dayDate === today).reduce((s, r) => s + r.km, 0)),
      pendingRequests, pendingChecks, appDrivers,
    },
  }
}

export async function dayTrack(dayId: string) {
  const points = await prisma.mobileLocationPoint.findMany({
    where: { dayId }, orderBy: { recordedAt: 'asc' }, take: 5000,
    select: { lat: true, lng: true, recordedAt: true, speed: true },
  })
  // Thin to ~600 points for drawing.
  const step = Math.max(1, Math.ceil(points.length / 600))
  return points.filter((_, i) => i % step === 0 || i === points.length - 1).map(p => ({
    lat: p.lat, lng: p.lng, t: p.recordedAt.toISOString(), kmh: p.speed != null ? Math.round(p.speed * 3.6) : null,
  }))
}

export async function listRequests(viewer: OpsViewer, status: 'PENDING' | 'ALL' = 'PENDING') {
  const rows = await prisma.mobileDriverRequest.findMany({
    where: status === 'PENDING' ? { status: 'PENDING' } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const drivers = await driverMap(Array.from(new Set(rows.map(r => r.driverId))))
  const current = await prisma.driver.findMany({
    where: { id: { in: rows.filter(r => r.kind === 'PROFILE_CHANGE').map(r => r.driverId) } },
    select: { id: true, phone: true, email: true, licenseNo: true, photoUrl: true, bankName: true, bankBranch: true, bankHolder: true, bankAccountNo: true, bankCode: true },
  })
  const currentById = new Map(current.map(c => [c.id, c]))
  return rows
    .map(r => {
      const d = drivers.get(r.driverId)
      return {
        ...r,
        driverName: d?.name ?? r.driverName,
        driverPhone: d?.phone ?? null,
        country: d?.country ?? null,
        current: r.kind === 'PROFILE_CHANGE' ? currentById.get(r.driverId) ?? null : null,
      }
    })
    .filter(r => !viewer.country || !r.country || r.country === viewer.country)
}

export async function decideRequest(id: string, decision: 'APPROVED' | 'REJECTED', note: string | null, viewer: OpsViewer) {
  const r = await prisma.mobileDriverRequest.findUnique({ where: { id } })
  if (!r) throw new MobileError('Request not found.', 404)
  if (r.status !== 'PENDING') throw new MobileError('This request was already answered.', 409)

  if (decision === 'APPROVED') {
    if (r.kind === 'PROFILE_CHANGE') {
      const payload = (r.payload ?? {}) as Record<string, unknown>
      const data: Record<string, string> = {}
      for (const k of PROFILE_FIELDS) if (typeof payload[k] === 'string') data[k] = payload[k] as string
      if (Object.keys(data).length) await prisma.driver.update({ where: { id: r.driverId }, data })
    }
    if ((r.kind === 'HANDOVER' || r.kind === 'FEEDBACK_WAIVER') && r.bookingRef) {
      const s = await prisma.mobileTripSession.findFirst({ where: { driverId: r.driverId, bookingRef: r.bookingRef } })
      if (s) {
        if (r.kind === 'HANDOVER') {
          await prisma.mobileTripDay.updateMany({ where: { sessionId: s.id, status: 'STARTED' }, data: { status: 'ENDED', endedAt: new Date() } })
          await prisma.mobileTripSession.update({ where: { id: s.id }, data: { status: 'HANDED_OVER' } })
        } else {
          await prisma.mobileTripSession.update({ where: { id: s.id }, data: { feedbackStatus: 'WAIVED', feedbackWaivedBy: viewer.name } })
        }
      }
    }
  }

  const updated = await prisma.mobileDriverRequest.update({
    where: { id },
    data: { status: decision, decidedByName: viewer.name, decidedAt: new Date(), decisionNote: note?.slice(0, 1000) ?? null },
  })

  const label: Record<string, string> = {
    PROFILE_CHANGE: 'profile change', HANDOVER: 'driver change', FEEDBACK_WAIVER: 'feedback waiver', HELP: 'help request',
  }
  await notify({
    actorType: 'DRIVER', actorId: r.driverId, kind: 'REQUEST_UPDATE',
    title: r.kind === 'HELP' ? 'Operations got your help call' : `Your ${label[r.kind] ?? 'request'} was ${decision === 'APPROVED' ? 'approved' : 'declined'}`,
    body: note || (r.bookingRef ? `File ${r.bookingRef}` : 'Open the app for details.'),
    data: { requestId: r.id, bookingRef: r.bookingRef },
    dedupeKey: `req-decided:${r.id}`,
  }).catch(err => console.error('[mobile decideRequest notify]', err))
  return updated
}

export async function listVehicleChecks(viewer: OpsViewer, status: 'SUBMITTED' | 'ALL' = 'SUBMITTED') {
  const rows = await prisma.mobileVehicleCheck.findMany({
    where: status === 'SUBMITTED' ? { status: 'SUBMITTED' } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const drivers = await driverMap(Array.from(new Set(rows.map(r => r.driverId))))
  return rows
    .map(r => ({ ...r, driverName: drivers.get(r.driverId)?.name ?? 'Driver', country: drivers.get(r.driverId)?.country ?? null, vehicle: drivers.get(r.driverId)?.vehicle ?? null }))
    .filter(r => !viewer.country || !r.country || r.country === viewer.country)
}

export async function decideVehicleCheck(id: string, decision: 'APPROVED' | 'REJECTED', note: string | null, viewer: OpsViewer) {
  const c = await prisma.mobileVehicleCheck.findUnique({ where: { id } })
  if (!c) throw new MobileError('Check not found.', 404)
  if (c.status !== 'SUBMITTED') throw new MobileError('This check was already reviewed.', 409)
  if (decision === 'REJECTED' && !note?.trim()) throw new MobileError('Tell the driver what to retake.')

  if (decision === 'APPROVED' && c.vehicleId) {
    const photos = (c.photos ?? {}) as Record<string, string>
    const data: Prisma.VehicleUpdateInput = {}
    if (photos.front) data.photoOutside = photos.front
    if (photos.inside) data.photoInside = photos.inside
    if (Object.keys(data).length) await prisma.vehicle.update({ where: { id: c.vehicleId }, data })
  }
  const updated = await prisma.mobileVehicleCheck.update({
    where: { id },
    data: { status: decision, reviewNote: note?.slice(0, 1000) ?? null, reviewedByName: viewer.name, reviewedAt: new Date() },
  })
  await notify({
    actorType: 'DRIVER', actorId: c.driverId, kind: 'VEHICLE_CHECK',
    title: decision === 'APPROVED' ? 'Vehicle photos approved ✅' : 'Please retake your vehicle photos',
    body: note || (decision === 'APPROVED' ? 'Thank you! Next renewal in 60 days.' : 'Open the app to send new photos.'),
    data: { vehicleCheckId: c.id },
    dedupeKey: `vc-decided:${c.id}`,
  }).catch(err => console.error('[mobile decideVehicleCheck notify]', err))
  return updated
}

export async function appAccounts(viewer: OpsViewer) {
  const accounts = await prisma.mobileDriverAccount.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 500 })
  const drivers = await driverMap(accounts.map(a => a.driverId))
  return accounts
    .map(a => ({
      driverId: a.driverId,
      name: drivers.get(a.driverId)?.name ?? '—',
      phone: drivers.get(a.driverId)?.phone ?? null,
      country: drivers.get(a.driverId)?.country ?? null,
      activated: !!a.passwordHash,
      language: a.language,
      platform: a.platform,
      appVersion: a.appVersion,
      lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
      lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    }))
    .filter(r => !viewer.country || !r.country || r.country === viewer.country)
}
