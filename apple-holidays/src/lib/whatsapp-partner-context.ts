/**
 * The partner side of the WhatsApp trip panel: when the open chat is a driver
 * or a vehicle vendor, who they are and what they are driving.
 *
 *   • Driver  — photo, vehicle (+ photos), whether they use the Aahaas Driver
 *               app, the day they are running now, the trip they are on,
 *               upcoming trips, and past trips with the guests' feedback.
 *   • Vendor  — their fleet (drivers + app status), vehicles with photos,
 *               live / upcoming jobs, past jobs with feedback.
 *
 * Read-only. Built on the same derivations the mobile app uses
 * (lib/mobile/trips.ts → loadDriverTrips, lib/mobile/vendor.ts → vendorJobs /
 * listDrivers / listVehicles), so the desk sees exactly what the driver sees.
 * Never selects a rate, advance balance or bank detail. The mobile_* tables
 * are tolerated being absent, as everywhere else.
 */
import type { BookingStatus, FeedbackRating } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { phoneMatches } from '@/lib/credential-match'
import { normalizeUploadUrl } from '@/lib/upload-path'
import { isMobileTableMissing } from '@/lib/mobile/http'
import { SANDBOX_REF_PREFIX } from '@/lib/mobile/sandbox'
import { addDaysYmd, loadDriverTrips, localTodayFor, type DriverTrip } from '@/lib/mobile/trips'
import { listDrivers, listVehicles, vendorJobs, type JobState } from '@/lib/mobile/vendor'

// ── Shapes sent to the panel ─────────────────────────────────────────────────

export type AppStatus = 'ON_APP' | 'CODE_SENT' | 'NOT_JOINED'

export interface PartnerApp {
  status: AppStatus
  lastSeenAt: string | null
  lastLoginAt: string | null
  platform: string | null
  appVersion: string | null
  codeSentAt: string | null
  /** At least one push token registered — notifications reach the phone. */
  push: boolean
}

export interface PartnerLive {
  dayId: string | null
  bookingRef: string
  fileNo: string | null
  startedAt: string
  lastPingAt: string | null
  km: number
  lat: number | null
  lng: number | null
  /** An open break ("MEAL", "FUEL" …) when the driver has paused the day. */
  pause: { reason: string; since: string } | null
}

export interface PartnerVehicle {
  id: string
  type: string
  plateNo: string
  brand: string | null
  model: string | null
  capacity: number
  isActive: boolean
  photoOutside: string | null
  photoInside: string | null
  driverName: string | null
  upcomingTrips?: number
}

export interface PartnerFeedback {
  /** Guest feedback form (public link) — Excellent / Good / Average / Poor. */
  driver: FeedbackRating | null
  vehicle: FeedbackRating | null
  overall: FeedbackRating | null
  remarks: string | null
  submittedAt: string | null
  /** TE call feedback, 1–5. */
  callRating: number | null
  callComment: string | null
}

export interface PartnerLeg {
  date: string
  time: string | null
  timeTo: string | null
  route: string
  serviceType: string | null
  details: string | null
  noDriverNeeded: boolean
  driverName?: string | null
  vehiclePlate?: string | null
}

export interface PartnerTrip {
  bookingRef: string
  fileNo: string
  title: string | null
  country: string | null
  status: BookingStatus | null
  leadGuest: string | null
  pax: { adults: number; children: number }
  startDate: string
  endDate: string
  /** ROUND_TRIP = Sri Lanka allocation (whole tour); MOVEMENTS = assigned legs only. */
  mode: 'ROUND_TRIP' | 'MOVEMENTS'
  vehicle: string | null
  phase: 'now' | 'upcoming' | 'past'
  /** Day of the trip today (1-based) while it runs. */
  dayNo: number | null
  dayCount: number
  legCount: number
  legs: PartnerLeg[]
  /** Hotel each night, while the trip is current or upcoming. */
  hotels: { date: string; name: string; city: string }[]
  specialNotes: string | null
  /** Vendor jobs: the driver they put on it and the job state. */
  driver?: { id: string | null; name: string; phone: string | null; photoUrl: string | null } | null
  state?: JobState
  /** Driver app progress on this trip. */
  appSession?: { status: string; km: number; completedAt: string | null; feedbackStatus: string | null } | null
  feedback: PartnerFeedback | null
}

export interface FeedbackStats {
  /** Guest-form driver / vehicle ratings: how many, and how many Excellent or Good. */
  driverRated: number
  driverPositive: number
  vehicleRated: number
  vehiclePositive: number
  /** TE call ratings, 1–5. */
  callRated: number
  callAverage: number | null
}

export interface VehicleCheck {
  id: string
  status: string
  createdAt: string
  odometer: number | null
  reviewNote: string | null
  photos: { label: string; url: string }[]
}

export interface DriverProfile {
  kind: 'DRIVER'
  id: string
  name: string
  phone: string
  email: string | null
  licenseNo: string | null
  photoUrl: string | null
  isActive: boolean
  country: string | null
  joinedAt: string
  vendor: { id: string; name: string; phone: string | null } | null
  vehicle: PartnerVehicle | null
  app: PartnerApp
  live: PartnerLive | null
  today: string
  current: PartnerTrip | null
  upcoming: PartnerTrip[]
  past: PartnerTrip[]
  checks: VehicleCheck[]
  stats: { tripsDone: number; upcoming: number; kmOnApp: number; feedback: FeedbackStats }
}

export interface VendorDriver {
  id: string
  name: string
  phone: string
  photoUrl: string | null
  isActive: boolean
  vehiclePlate: string | null
  app: { status: AppStatus; lastSeenAt: string | null; platform: string | null } | null
  live: { bookingRef: string; km: number; lastPingAt: string | null } | null
  upcomingTrips: number
  nextTrip: { date: string; fileNo: string; route: string } | null
}

export interface VendorProfile {
  kind: 'VENDOR'
  id: string
  name: string
  phone: string | null
  whatsappPhone: string | null
  email: string | null
  address: string | null
  country: string | null
  isRegistered: boolean
  isActive: boolean
  today: string
  drivers: VendorDriver[]
  vehicles: PartnerVehicle[]
  current: PartnerTrip[]
  upcoming: PartnerTrip[]
  past: PartnerTrip[]
  stats: { drivers: number; onApp: number; vehicles: number; liveNow: number; upcoming: number; needsAction: number; tripsDone: number; feedback: FeedbackStats }
}

export type PartnerProfile = DriverProfile | VendorProfile

export interface PartnerResponse {
  profiles: PartnerProfile[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PAST_DAYS = 120
const AHEAD_DAYS = 150
const PAST_LIMIT = 15
const UPCOMING_LIMIT = 12

const url = (u: string | null | undefined) => normalizeUploadUrl(u ?? null)
const isSandbox = (ref: string) => ref.startsWith(SANDBOX_REF_PREFIX)
const positive = (r: FeedbackRating | null) => r === 'EXCELLENT' || r === 'GOOD'

/** Runs a read on a mobile_* table, treating a missing table as "no rows". */
async function mobileRead<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try { return await fn() } catch (err) {
    if (isMobileTableMissing(err)) return empty
    throw err
  }
}

function routeOf(from: string | null | undefined, to: string | null | undefined, location: string | null | undefined) {
  const f = from?.trim()
  const t = to?.trim()
  if (f && t) return `${f} → ${t}`
  return f || t || location?.trim() || '—'
}

async function feedbackFor(refs: string[]): Promise<Map<string, PartnerFeedback>> {
  const out = new Map<string, PartnerFeedback>()
  if (!refs.length) return out
  const rows = await prisma.booking.findMany({
    where: { bookingRef: { in: refs } },
    select: {
      bookingRef: true,
      guestFeedback: { select: { transportDriver: true, transportVehicle: true, overallExperience: true, remarks: true, submittedAt: true } },
      customerFeedback: { select: { rating: true, comment: true } },
    },
  })
  for (const r of rows) {
    const g = r.guestFeedback
    const c = r.customerFeedback
    if (!g && !c) continue
    out.set(r.bookingRef, {
      driver: g?.transportDriver ?? null,
      vehicle: g?.transportVehicle ?? null,
      overall: g?.overallExperience ?? null,
      remarks: g?.remarks?.trim() || null,
      submittedAt: g?.submittedAt.toISOString() ?? null,
      callRating: c?.rating ?? null,
      callComment: c?.comment?.trim() || null,
    })
  }
  return out
}

function feedbackStats(list: (PartnerFeedback | null)[]): FeedbackStats {
  const fb = list.filter((f): f is PartnerFeedback => !!f)
  const drv = fb.filter(f => f.driver)
  const veh = fb.filter(f => f.vehicle)
  const calls = fb.filter(f => f.callRating != null)
  return {
    driverRated: drv.length,
    driverPositive: drv.filter(f => positive(f.driver)).length,
    vehicleRated: veh.length,
    vehiclePositive: veh.filter(f => positive(f.vehicle)).length,
    callRated: calls.length,
    callAverage: calls.length ? Math.round((calls.reduce((n, f) => n + (f.callRating ?? 0), 0) / calls.length) * 10) / 10 : null,
  }
}

function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function phaseOf(start: string, end: string, today: string): PartnerTrip['phase'] {
  if (end < today) return 'past'
  if (start > today) return 'upcoming'
  return 'now'
}

// ── Driver ───────────────────────────────────────────────────────────────────

function driverTripToPartner(t: DriverTrip, today: string): PartnerTrip {
  const phase = phaseOf(t.startDate, t.endDate, today)
  const mine = t.days.flatMap(d => d.movements.filter(m => m.mine).map(m => ({ d, m })))
  const keepDetail = phase !== 'past'
  return {
    bookingRef: t.bookingRef,
    fileNo: t.fileNo,
    title: null,
    country: t.country,
    status: t.status,
    leadGuest: t.leadGuest,
    pax: t.pax,
    startDate: t.startDate,
    endDate: t.endDate,
    mode: t.mode,
    vehicle: t.vehicle,
    phase,
    dayNo: phase === 'now' ? dayDiff(t.startDate, today) + 1 : null,
    dayCount: dayDiff(t.startDate, t.endDate) + 1,
    legCount: mine.filter(x => !x.m.noDriverNeeded).length,
    legs: (keepDetail ? mine : mine.slice(0, 1)).map(({ d, m }) => ({
      date: d.date,
      time: m.time,
      timeTo: m.timeTo,
      route: routeOf(m.from, m.to, m.location),
      serviceType: m.serviceType || null,
      details: keepDetail ? m.details?.trim() || null : null,
      noDriverNeeded: m.noDriverNeeded,
    })),
    hotels: keepDetail ? t.days.filter(d => d.hotel).map(d => ({ date: d.date, name: d.hotel!.name, city: d.hotel!.city })) : [],
    specialNotes: keepDetail ? t.specialNotes : null,
    feedback: null,
  }
}

async function driverProfile(driverId: string, inScope: (c: string | null) => boolean): Promise<DriverProfile | null> {
  const d = await prisma.driver.findUnique({
    where: { id: driverId },
    // Never advanceBalance / bank*: money stays on the Ground pages.
    select: {
      id: true, name: true, phone: true, email: true, licenseNo: true, photoUrl: true, isActive: true, country: true, createdAt: true,
      vehicle: { select: { id: true, type: true, plateNo: true, brand: true, model: true, capacity: true, isActive: true, photoOutside: true, photoInside: true } },
      vendorOwner: { select: { id: true, name: true, phone: true, whatsappPhone: true } },
    },
  })
  if (!d) return null
  const today = localTodayFor(d.country)

  const [account, code, pushCount, liveDay, sessions, checks, trips] = await Promise.all([
    mobileRead(() => prisma.mobileDriverAccount.findUnique({
      where: { driverId },
      select: { passwordHash: true, lastLoginAt: true, lastSeenAt: true, platform: true, appVersion: true },
    }), null),
    mobileRead(() => prisma.mobileOtp.findFirst({
      where: { driverId, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }), null),
    mobileRead(() => prisma.mobilePushToken.count({ where: { actorType: 'DRIVER', actorId: driverId } }), 0),
    mobileRead(() => prisma.mobileTripDay.findFirst({
      where: { driverId, status: 'STARTED', startedAt: { gte: new Date(Date.now() - 36 * 3_600_000) }, NOT: { bookingRef: { startsWith: SANDBOX_REF_PREFIX } } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, bookingRef: true, startedAt: true, lastPingAt: true, distanceKm: true, lastLat: true, lastLng: true },
    }), null),
    mobileRead(() => prisma.mobileTripSession.findMany({
      where: { driverId },
      orderBy: { startedAt: 'desc' },
      take: 200,
      select: { bookingRef: true, status: true, totalKm: true, completedAt: true, feedbackStatus: true },
    }), []),
    mobileRead(() => prisma.mobileVehicleCheck.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { id: true, status: true, createdAt: true, odometer: true, reviewNote: true, photos: true },
    }), []),
    loadDriverTrips(driverId, addDaysYmd(today, -PAST_DAYS), addDaysYmd(today, AHEAD_DAYS)),
  ])

  const pause = liveDay
    ? await mobileRead(() => prisma.mobileTripPause.findFirst({
        where: { dayId: liveDay.id, endedAt: null },
        orderBy: { startedAt: 'desc' },
        select: { reason: true, startedAt: true },
      }), null)
    : null

  const visible = trips.filter(t => !isSandbox(t.bookingRef) && inScope(t.country))
  const mapped = visible.map(t => driverTripToPartner(t, today))
  const sessionByRef = new Map(sessions.map(s => [s.bookingRef, s]))
  const past = mapped.filter(t => t.phase === 'past').reverse()
  const fb = await feedbackFor(past.map(t => t.bookingRef))
  for (const t of mapped) {
    const s = sessionByRef.get(t.bookingRef)
    t.appSession = s ? { status: s.status, km: Math.round(Number(s.totalKm) * 10) / 10, completedAt: s.completedAt?.toISOString() ?? null, feedbackStatus: s.feedbackStatus } : null
    t.feedback = fb.get(t.bookingRef) ?? null
  }

  const now = mapped.filter(t => t.phase === 'now')
  // The trip the driver has a day running on wins; otherwise the earliest running one.
  const current = (liveDay && now.find(t => t.bookingRef === liveDay.bookingRef)) || now[0] || null
  const upcoming = [...now.filter(t => t !== current), ...mapped.filter(t => t.phase === 'upcoming')]
  const joined = !!account && (!!account.passwordHash || !!account.lastLoginAt)

  return {
    kind: 'DRIVER',
    id: d.id,
    name: d.name,
    phone: d.phone,
    email: d.email,
    licenseNo: d.licenseNo,
    photoUrl: url(d.photoUrl),
    isActive: d.isActive,
    country: d.country,
    joinedAt: d.createdAt.toISOString(),
    vendor: d.vendorOwner ? { id: d.vendorOwner.id, name: d.vendorOwner.name, phone: d.vendorOwner.whatsappPhone || d.vendorOwner.phone } : null,
    vehicle: d.vehicle ? {
      ...d.vehicle,
      photoOutside: url(d.vehicle.photoOutside),
      photoInside: url(d.vehicle.photoInside),
      driverName: d.name,
    } : null,
    app: {
      status: joined ? 'ON_APP' : code ? 'CODE_SENT' : 'NOT_JOINED',
      lastSeenAt: account?.lastSeenAt?.toISOString() ?? null,
      lastLoginAt: account?.lastLoginAt?.toISOString() ?? null,
      platform: account?.platform ?? null,
      appVersion: account?.appVersion ?? null,
      codeSentAt: code?.createdAt.toISOString() ?? null,
      push: pushCount > 0,
    },
    live: liveDay ? {
      dayId: liveDay.id,
      bookingRef: liveDay.bookingRef,
      fileNo: mapped.find(t => t.bookingRef === liveDay.bookingRef)?.fileNo ?? null,
      startedAt: liveDay.startedAt.toISOString(),
      lastPingAt: liveDay.lastPingAt?.toISOString() ?? null,
      km: Math.round(Number(liveDay.distanceKm) * 10) / 10,
      lat: liveDay.lastLat,
      lng: liveDay.lastLng,
      pause: pause ? { reason: pause.reason, since: pause.startedAt.toISOString() } : null,
    } : null,
    today,
    current,
    upcoming: upcoming.slice(0, UPCOMING_LIMIT),
    past: past.slice(0, PAST_LIMIT),
    checks: checks.map(c => ({
      id: c.id,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      odometer: c.odometer,
      reviewNote: c.reviewNote,
      photos: Object.entries((c.photos ?? {}) as Record<string, unknown>)
        .filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1])
        .map(([label, u]) => ({ label, url: url(u)! })),
    })),
    stats: {
      tripsDone: past.length,
      upcoming: upcoming.length,
      kmOnApp: Math.round(sessions.reduce((n, s) => n + Number(s.totalKm), 0)),
      feedback: feedbackStats(past.map(t => t.feedback)),
    },
  }
}

// ── Vendor ───────────────────────────────────────────────────────────────────

async function vendorProfile(vendorId: string, inScope: (c: string | null) => boolean): Promise<VendorProfile | null> {
  const v = await prisma.vehicleVendor.findUnique({
    where: { id: vendorId },
    // Never password / bank*.
    select: { id: true, name: true, phone: true, whatsappPhone: true, email: true, address: true, country: true, isRegistered: true, isActive: true },
  })
  if (!v) return null
  const ctx = { vendorId: v.id, name: v.name, country: v.country }
  const today = localTodayFor(v.country)

  const [drivers, vehicles, jobs] = await Promise.all([
    listDrivers(ctx),
    listVehicles(ctx),
    vendorJobs(ctx, addDaysYmd(today, -PAST_DAYS), addDaysYmd(today, AHEAD_DAYS)),
  ])

  const visibleJobs = jobs.filter(j => !isSandbox(j.bookingRef) && inScope(j.country))
  const trips: PartnerTrip[] = visibleJobs.map(j => {
    const phase = j.state === 'DONE' ? 'past' : phaseOf(j.startDate, j.endDate, today)
    const keep = phase !== 'past'
    return {
      bookingRef: j.bookingRef,
      fileNo: j.fileNo,
      title: j.title,
      country: j.country,
      status: null,
      leadGuest: null,
      pax: j.pax,
      startDate: j.startDate,
      endDate: j.endDate,
      mode: j.wholeBooking ? 'ROUND_TRIP' : 'MOVEMENTS',
      vehicle: j.vehicle ? [j.vehicle.type, j.vehicle.plateNo].filter(Boolean).join(' · ') : null,
      phase,
      dayNo: phase === 'now' ? dayDiff(j.startDate, today) + 1 : null,
      dayCount: dayDiff(j.startDate, j.endDate) + 1,
      legCount: j.legs.filter(l => !l.noDriverNeeded).length,
      legs: (keep ? j.legs : j.legs.slice(0, 1)).map(l => ({
        date: l.date, time: l.time, timeTo: l.timeTo, route: routeOf(l.from, l.to, l.location),
        serviceType: l.serviceType || null, details: null, noDriverNeeded: l.noDriverNeeded,
        driverName: l.driverName, vehiclePlate: l.vehiclePlate,
      })),
      hotels: [],
      specialNotes: keep ? j.notes : null,
      driver: j.driver ? { ...j.driver, photoUrl: url(j.driver.photoUrl) } : null,
      state: j.state,
      appSession: null,
      feedback: null,
    }
  })

  // Lead guest names, and feedback for the jobs already done.
  const refs = Array.from(new Set(trips.map(t => t.bookingRef)))
  const [leads, fb] = await Promise.all([
    refs.length
      ? prisma.booking.findMany({
          where: { bookingRef: { in: refs } },
          select: { bookingRef: true, status: true, passengers: { where: { isLead: true }, take: 1, select: { name: true } } },
        })
      : Promise.resolve([]),
    feedbackFor(Array.from(new Set(trips.filter(t => t.phase === 'past').map(t => t.bookingRef)))),
  ])
  const leadByRef = new Map(leads.map(l => [l.bookingRef, l]))
  for (const t of trips) {
    const b = leadByRef.get(t.bookingRef)
    t.leadGuest = b?.passengers[0]?.name ?? null
    t.status = b?.status ?? null
    if (t.phase === 'past') t.feedback = fb.get(t.bookingRef) ?? null
  }

  const past = trips.filter(t => t.phase === 'past').reverse()
  const current = trips.filter(t => t.phase === 'now')
  const upcoming = trips.filter(t => t.phase === 'upcoming')
  const active = drivers.filter(d => d.isActive)
  // Feedback is per booking: a tour split into several movement jobs counts once.
  const pastByRef = new Map(past.map(t => [t.bookingRef, t.feedback]))

  return {
    kind: 'VENDOR',
    id: v.id,
    name: v.name,
    phone: v.phone,
    whatsappPhone: v.whatsappPhone,
    email: v.email,
    address: v.address,
    country: v.country,
    isRegistered: v.isRegistered,
    isActive: v.isActive,
    today,
    drivers: drivers.map(d => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      photoUrl: url(d.photoUrl),
      isActive: d.isActive,
      vehiclePlate: d.vehicle?.plateNo ?? null,
      app: d.app ? { status: d.app.status, lastSeenAt: d.app.lastSeenAt, platform: d.app.platform } : null,
      live: d.live ? { bookingRef: d.live.bookingRef, km: d.live.km, lastPingAt: d.live.lastPingAt } : null,
      upcomingTrips: d.upcomingTrips,
      nextTrip: d.nextTrip,
    })),
    vehicles: vehicles.map(x => ({
      id: x.id, type: x.type, plateNo: x.plateNo, brand: x.brand, model: x.model, capacity: x.capacity, isActive: x.isActive,
      photoOutside: url(x.photoOutside), photoInside: url(x.photoInside),
      driverName: x.driver?.name ?? null, upcomingTrips: x.upcomingTrips,
    })),
    current,
    upcoming: upcoming.slice(0, UPCOMING_LIMIT * 2),
    past: past.slice(0, PAST_LIMIT * 2),
    stats: {
      drivers: active.length,
      onApp: active.filter(d => d.app?.status === 'ON_APP').length,
      vehicles: vehicles.filter(x => x.isActive).length,
      liveNow: drivers.filter(d => d.live).length,
      upcoming: current.length + upcoming.length,
      needsAction: [...current, ...upcoming].filter(t => t.state === 'NEEDS_DRIVER' || t.state === 'NEEDS_VEHICLE').length,
      tripsDone: past.length,
      feedback: feedbackStats(Array.from(pastByRef.values())),
    },
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Every driver and vendor this number belongs to. Usually one; an owner-driver
 * is both. `inScope` hides trips in countries the viewer cannot open.
 */
export async function loadPartnerProfiles(phone: string, inScope: (country: string | null) => boolean): Promise<PartnerResponse> {
  const [drivers, vendors] = await Promise.all([
    prisma.driver.findMany({ select: { id: true, phone: true, isActive: true } }),
    prisma.vehicleVendor.findMany({ select: { id: true, phone: true, whatsappPhone: true, isActive: true } }),
  ])
  const driverIds = drivers
    .filter(d => phoneMatches(d.phone, phone))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive))
    .slice(0, 3)
    .map(d => d.id)
  const vendorIds = vendors
    .filter(v => phoneMatches(v.whatsappPhone, phone) || phoneMatches(v.phone, phone))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive))
    .slice(0, 2)
    .map(v => v.id)

  const [dp, vp] = await Promise.all([
    Promise.all(driverIds.map(id => driverProfile(id, inScope))),
    Promise.all(vendorIds.map(id => vendorProfile(id, inScope))),
  ])
  return { profiles: [...dp, ...vp].filter((p): p is PartnerProfile => !!p) }
}
