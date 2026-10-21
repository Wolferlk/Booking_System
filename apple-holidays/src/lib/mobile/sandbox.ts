/**
 * Driver App — sandbox (test) drivers.
 *
 * A test driver signs in like any other driver but never sees real bookings.
 * Their trips are generated here, in code. Week trips are anchored to this
 * week's Monday (stable all week); "today" trips are anchored to the day.
 *
 *   ONG   this week Mon → Sun        ongoing (session ACTIVE, past days ended)
 *   TDA   today, 1 day               airport transfer (ready to start)
 *   TDB   today, 1 day               Galle day tour (ready to start)
 *   TMR   tomorrow → +1              upcoming, starts tomorrow
 *   UP1   next week Tue → Thu        upcoming
 *   UP2   week after Tue → Fri       upcoming
 *   UP3   in 3 weeks, 5 days         upcoming hill-country tour
 *   UP4   in 4 weeks, 2 days         upcoming Kandy weekend
 *   DN5   last Fri → Sat             finished
 *   DN1   last week Tue → Thu        finished
 *   DN2   two weeks ago Fri → Sun    finished
 *   MSD   2 weeks ago, 1 day         never started ("not driven")
 *   DN3   ~3 weeks ago, 7 days       finished round trip
 *   DN4   ~4 weeks ago, 1 day        finished transfer
 *
 * Nothing is written to bookings, agendas, assignments or any ops table. The
 * only writes are the app's own progress rows (mobile_trip_sessions /
 * mobile_trip_days / mobile_location_points), keyed by `sbx-…` booking ids and
 * `TEST-SBX-…` refs, and every ops-facing view filters those refs out.
 * Actions that would reach ops (requests, hand-over, vehicle check, profile
 * change, claiming open trips, staff notifications) are refused or skipped.
 *
 * Who is a test driver: MOBILE_SANDBOX_DRIVERS (comma-separated driver e-mails
 * or ids), default `sandun@mail.com`.
 */
import { prisma } from '@/lib/prisma'
import type { DriverTrip, TripDayPlan, TripMovement } from './trips'
import { MobileError } from './http'

export const SANDBOX_REF_PREFIX = 'TEST-SBX-'
export const SANDBOX_ID_PREFIX = 'sbx-'

const LIST = (process.env.MOBILE_SANDBOX_DRIVERS ?? 'sandun@mail.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

const cache = new Map<string, { sandbox: boolean; country: string | null }>()

async function lookup(driverId: string) {
  const hit = cache.get(driverId)
  if (hit) return hit
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { email: true, country: true } })
  const v = {
    sandbox: !!d && (LIST.includes(driverId.toLowerCase()) || (!!d.email && LIST.includes(d.email.trim().toLowerCase()))),
    country: d?.country ?? null,
  }
  cache.set(driverId, v)
  return v
}

export async function isSandboxDriver(driverId: string): Promise<boolean> {
  return (await lookup(driverId)).sandbox
}

export const isSandboxRef = (ref: string | null | undefined) => !!ref && ref.startsWith(SANDBOX_REF_PREFIX)
export const isSandboxBookingId = (id: string | null | undefined) => !!id && id.startsWith(SANDBOX_ID_PREFIX)

/** Refuse an action that would reach operations. */
export async function refuseForSandbox(driverId: string, what: string) {
  if (await isSandboxDriver(driverId)) {
    throw new MobileError(`Test driver account — ${what} is not sent to operations.`, 409, 'sandbox')
  }
}

// ── dates (kept local so this file does not import trips.ts at runtime) ──
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay() // 0 = Sun
  return addDays(day, dow === 0 ? -6 : 1 - dow)
}

// ── fixtures ──
interface Leg { time: string; from: string; to: string; details: string; type?: string }
interface FixtureDay { hotel: { name: string; city: string } | null; legs: Leg[]; flight?: { flightNo: string; from: string; to: string; dep: string; arr: string } }

const ROUND: FixtureDay[] = [
  { hotel: { name: 'Jetwing Blue (TEST)', city: 'Negombo' }, flight: { flightNo: 'UL 309', from: 'SIN', to: 'CMB', dep: '07:45', arr: '09:05' },
    legs: [{ time: '09:30', from: 'Bandaranaike Airport (CMB)', to: 'Jetwing Blue, Negombo', details: 'Airport pick-up — welcome board "TEST GUEST"', type: 'TRANSFER' }] },
  { hotel: { name: 'Aliya Resort (TEST)', city: 'Sigiriya' },
    legs: [{ time: '08:00', from: 'Jetwing Blue, Negombo', to: 'Aliya Resort, Sigiriya', details: 'Transfer via Kurunegala, lunch stop at Dambulla', type: 'TRANSFER' }] },
  { hotel: { name: 'Aliya Resort (TEST)', city: 'Sigiriya' },
    legs: [{ time: '06:30', from: 'Aliya Resort', to: 'Sigiriya Rock Fortress', details: 'Early climb, return to hotel', type: 'TOUR' },
      { time: '15:00', from: 'Aliya Resort', to: 'Minneriya National Park', details: 'Jeep safari — driver waits at park gate', type: 'TOUR' }] },
  { hotel: { name: 'Earl\'s Regency (TEST)', city: 'Kandy' },
    legs: [{ time: '08:30', from: 'Aliya Resort, Sigiriya', to: 'Earl\'s Regency, Kandy', details: 'Via Matale spice garden. Evening Temple of the Tooth', type: 'TRANSFER' }] },
  { hotel: { name: 'Heritance Tea Factory (TEST)', city: 'Nuwara Eliya' },
    legs: [{ time: '09:00', from: 'Earl\'s Regency, Kandy', to: 'Heritance Tea Factory, Nuwara Eliya', details: 'Tea factory visit on the way', type: 'TRANSFER' }] },
  { hotel: { name: 'Cinnamon Bey (TEST)', city: 'Beruwala' },
    legs: [{ time: '08:00', from: 'Nuwara Eliya', to: 'Cinnamon Bey, Beruwala', details: 'Long drive — break at Ella / Ratnapura as guest wishes', type: 'TRANSFER' }] },
  { hotel: null, flight: { flightNo: 'UL 308', from: 'CMB', to: 'SIN', dep: '23:55', arr: '06:10' },
    legs: [{ time: '18:00', from: 'Cinnamon Bey, Beruwala', to: 'Bandaranaike Airport (CMB)', details: 'Airport drop — 3 hours before flight', type: 'TRANSFER' }] },
]

const SHORT_A: FixtureDay[] = [
  { hotel: { name: 'Cinnamon Grand (TEST)', city: 'Colombo' },
    legs: [{ time: '10:00', from: 'Bandaranaike Airport (CMB)', to: 'Cinnamon Grand, Colombo', details: 'Airport pick-up', type: 'TRANSFER' }] },
  { hotel: { name: 'Cinnamon Grand (TEST)', city: 'Colombo' },
    legs: [{ time: '09:00', from: 'Cinnamon Grand', to: 'Colombo city tour', details: 'Gangaramaya, Galle Face, Pettah market', type: 'TOUR' }] },
  { hotel: null,
    legs: [{ time: '12:00', from: 'Cinnamon Grand, Colombo', to: 'Bandaranaike Airport (CMB)', details: 'Airport drop', type: 'TRANSFER' }] },
]

const SHORT_B: FixtureDay[] = [
  { hotel: { name: 'Jetwing Lighthouse (TEST)', city: 'Galle' },
    legs: [{ time: '10:30', from: 'Bandaranaike Airport (CMB)', to: 'Jetwing Lighthouse, Galle', details: 'Southern expressway', type: 'TRANSFER' }] },
  { hotel: { name: 'Jetwing Lighthouse (TEST)', city: 'Galle' },
    legs: [{ time: '06:00', from: 'Jetwing Lighthouse', to: 'Mirissa harbour', details: 'Whale watching — pick up again at 12:00', type: 'TOUR' }] },
  { hotel: { name: 'Jetwing Yala (TEST)', city: 'Yala' },
    legs: [{ time: '09:00', from: 'Galle', to: 'Jetwing Yala', details: 'Afternoon safari arranged by hotel', type: 'TRANSFER' }] },
  { hotel: null,
    legs: [{ time: '07:00', from: 'Jetwing Yala', to: 'Bandaranaike Airport (CMB)', details: 'Airport drop', type: 'TRANSFER' }] },
]

const TODAY_TRANSFER: FixtureDay[] = [
  { hotel: null, flight: { flightNo: 'EK 650', from: 'DXB', to: 'CMB', dep: '09:10', arr: '15:05' },
    legs: [
      { time: '15:30', from: 'Bandaranaike Airport (CMB)', to: 'Shangri-La, Colombo', details: 'Arrival pick-up — guest has 2 large bags + golf set', type: 'TRANSFER' },
      { time: '19:30', from: 'Shangri-La, Colombo', to: 'Ministry of Crab, Colombo', details: 'Dinner drop — wait and return to hotel', type: 'TRANSFER' },
    ] },
]

const TODAY_TOUR: FixtureDay[] = [
  { hotel: null,
    legs: [
      { time: '07:00', from: 'Taj Bentota', to: 'Galle Fort', details: 'Day tour — pick up at hotel lobby', type: 'TOUR' },
      { time: '12:30', from: 'Galle Fort', to: 'Unawatuna Beach', details: 'Lunch stop, 2 hours', type: 'TOUR' },
      { time: '16:00', from: 'Unawatuna Beach', to: 'Taj Bentota', details: 'Return to hotel', type: 'TRANSFER' },
    ] },
]

const TWO_DAY_KANDY: FixtureDay[] = [
  { hotel: { name: 'The Kandy House (TEST)', city: 'Kandy' },
    legs: [{ time: '08:00', from: 'Hilton Colombo', to: 'The Kandy House, Kandy', details: 'Via Pinnawala elephant orphanage', type: 'TRANSFER' }] },
  { hotel: null,
    legs: [
      { time: '09:00', from: 'The Kandy House', to: 'Peradeniya Botanical Garden', details: '2-hour visit', type: 'TOUR' },
      { time: '13:00', from: 'Peradeniya', to: 'Hilton Colombo', details: 'Return to Colombo', type: 'TRANSFER' },
    ] },
]

const HILL_COUNTRY: FixtureDay[] = [
  { hotel: { name: 'Mandara Rosen (TEST)', city: 'Kataragama' }, flight: { flightNo: 'QR 668', from: 'DOH', to: 'CMB', dep: '02:10', arr: '09:00' },
    legs: [{ time: '09:45', from: 'Bandaranaike Airport (CMB)', to: 'Mandara Rosen, Kataragama', details: 'Long transfer — rest stops every 2 hours', type: 'TRANSFER' }] },
  { hotel: { name: '98 Acres (TEST)', city: 'Ella' },
    legs: [{ time: '08:30', from: 'Kataragama', to: '98 Acres, Ella', details: 'Ravana falls photo stop', type: 'TRANSFER' }] },
  { hotel: { name: '98 Acres (TEST)', city: 'Ella' },
    legs: [{ time: '07:30', from: '98 Acres', to: 'Nine Arches Bridge', details: 'Train passes ~09:30 — guests want photos', type: 'TOUR' },
      { time: '14:00', from: 'Nine Arches Bridge', to: 'Little Adam\'s Peak', details: 'Easy hike, 1.5 hours', type: 'TOUR' }] },
  { hotel: { name: 'Grand Hotel (TEST)', city: 'Nuwara Eliya' },
    legs: [{ time: '09:00', from: 'Ella', to: 'Grand Hotel, Nuwara Eliya', details: 'Tea estate visit on the way', type: 'TRANSFER' }] },
  { hotel: null, flight: { flightNo: 'QR 669', from: 'CMB', to: 'DOH', dep: '21:30', arr: '00:20' },
    legs: [{ time: '12:00', from: 'Nuwara Eliya', to: 'Bandaranaike Airport (CMB)', details: 'Airport drop', type: 'TRANSFER' }] },
]

const ONE_DAY_DROP: FixtureDay[] = [
  { hotel: null,
    legs: [{ time: '05:30', from: 'Cinnamon Lakeside, Colombo', to: 'Bandaranaike Airport (CMB)', details: 'Early airport drop', type: 'TRANSFER' }] },
]

/** Fake km for days seeded as already driven. */
const SEED_KM = [38.4, 152.7, 41.2, 96.5, 78.9, 183.3, 92.6]

/**
 * ONGOING = session seeded ACTIVE (past days ended); DONE = seeded COMPLETED;
 * UPCOMING / READY / MISSED = nothing seeded (MISSED = in the past, never started).
 */
interface Fixture {
  code: string; start: string; days: FixtureDay[]; guest: string; adults: number; children: number
  phase: 'ONGOING' | 'UPCOMING' | 'READY' | 'DONE' | 'MISSED'; note?: string; mode?: DriverTrip['mode']
}

function fixturesFor(today: string): Fixture[] {
  const m = mondayOf(today)
  const td = today.replace(/-/g, '').slice(4) // MMDD — "today" trips get a new ref each day
  return [
    { code: 'ONG', start: m, days: ROUND, guest: 'Mr & Mrs Test Silva', adults: 2, children: 1, phase: 'ONGOING', note: 'TEST TRIP — not a real booking. Child seat needed.' },
    { code: `TDA${td}`, start: today, days: TODAY_TRANSFER, guest: 'Mr Test Rahman', adults: 1, children: 0, phase: 'READY', mode: 'MOVEMENTS', note: 'TEST TRIP — airport transfer today. Golf set: needs a car with a big boot.' },
    { code: `TDB${td}`, start: today, days: TODAY_TOUR, guest: 'Test Couple Andersson', adults: 2, children: 0, phase: 'READY', mode: 'MOVEMENTS', note: 'TEST TRIP — Galle day tour today.' },
    { code: `TMR${td}`, start: addDays(today, 1), days: TWO_DAY_KANDY, guest: 'Dr Test Nakamura', adults: 2, children: 1, phase: 'UPCOMING', note: 'TEST TRIP — starts tomorrow.' },
    { code: 'UP1', start: addDays(m, 8), days: SHORT_A, guest: 'Ms Test Perera', adults: 1, children: 0, phase: 'UPCOMING', note: 'TEST TRIP — not a real booking.' },
    { code: 'UP2', start: addDays(m, 15), days: SHORT_B, guest: 'Test Family Fernando', adults: 2, children: 2, phase: 'UPCOMING', note: 'TEST TRIP — not a real booking.' },
    { code: 'UP3', start: addDays(m, 22), days: HILL_COUNTRY, guest: 'Mr & Mrs Test Al-Hashimi', adults: 2, children: 0, phase: 'UPCOMING', note: 'TEST TRIP — VIP guests, water bottles in the car.' },
    { code: 'UP4', start: addDays(m, 33), days: TWO_DAY_KANDY, guest: 'Test Friends Group', adults: 5, children: 0, phase: 'UPCOMING', note: 'TEST TRIP — 5 adults, van needed.' },
    { code: 'DN5', start: addDays(m, -3), days: TWO_DAY_KANDY, guest: 'Ms Test Wijesinghe', adults: 1, children: 0, phase: 'DONE' },
    { code: 'DN1', start: addDays(m, -6), days: SHORT_A, guest: 'Mr Test Jayasuriya', adults: 2, children: 0, phase: 'DONE' },
    { code: 'DN2', start: addDays(m, -10), days: SHORT_A, guest: 'Test Group Wickrama', adults: 4, children: 0, phase: 'DONE' },
    { code: 'MSD', start: addDays(m, -12), days: ONE_DAY_DROP, guest: 'Mr Test Gunawardena', adults: 1, children: 0, phase: 'MISSED', mode: 'MOVEMENTS' },
    { code: 'DN3', start: addDays(m, -21), days: ROUND, guest: 'Test Family Müller', adults: 2, children: 2, phase: 'DONE' },
    { code: 'DN4', start: addDays(m, -25), days: ONE_DAY_DROP, guest: 'Mrs Test de Silva', adults: 1, children: 0, phase: 'DONE', mode: 'MOVEMENTS' },
  ]
}

const refOf = (monday: string, code: string) => `${SANDBOX_REF_PREFIX}${monday.replace(/-/g, '').slice(2)}-${code}`
const idOf = (driverId: string, monday: string, code: string) => `${SANDBOX_ID_PREFIX}${driverId}-${monday}-${code}`

function toTrip(driverId: string, country: string | null, monday: string, f: Fixture): DriverTrip {
  const ref = refOf(monday, f.code)
  const days: TripDayPlan[] = f.days.map((d, i) => {
    const date = addDays(f.start, i)
    const movements: TripMovement[] = d.legs.map((l, j) => ({
      id: `${ref}-${i + 1}-${j + 1}`,
      time: l.time, timeTo: null, from: l.from, to: l.to,
      location: l.to, details: l.details, serviceType: l.type ?? 'TRANSFER',
      mealPlan: d.hotel ? 'BB' : null, noDriverNeeded: false, mine: true,
    }))
    return {
      date, dayNo: i + 1, movements,
      hotel: d.hotel ? { name: d.hotel.name, city: d.hotel.city, address: null } : null,
      flights: d.flight ? [d.flight] : [],
    }
  })
  return {
    bookingId: idOf(driverId, monday, f.code),
    bookingRef: ref,
    fileNo: ref,
    country: country ?? 'SRILANKA',
    status: 'DRIVER_ALLOCATED',
    leadGuest: f.guest,
    pax: { adults: f.adults, children: f.children },
    startDate: days[0].date,
    endDate: days[days.length - 1].date,
    mode: f.mode ?? 'ROUND_TRIP',
    vehicle: 'Car · TEST-0000',
    specialNotes: f.note ?? 'TEST TRIP — not a real booking.',
    days,
  }
}

const seeded = new Set<string>()

/** Give the finished trips and the ongoing trip their history, once. Writes mobile_* only. */
async function seed(driverId: string, country: string | null, monday: string, today: string, trips: { f: Fixture; t: DriverTrip }[]) {
  // Per day: "today" trips are new every day; week trips are already seeded and skipped.
  const key = `${driverId}:${today}`
  if (seeded.has(key)) return
  // A day left running on an earlier week's test trip would block "Start day"
  // on this week's — close it (test rows only).
  await prisma.mobileTripDay.updateMany({
    where: { driverId, status: 'STARTED', bookingRef: { startsWith: SANDBOX_REF_PREFIX, notIn: trips.map(x => x.t.bookingRef) } },
    data: { status: 'ENDED', endedAt: new Date() },
  })
  for (const { f, t } of trips) {
    if (f.phase !== 'ONGOING' && f.phase !== 'DONE') continue
    const pastDays = t.days.filter(d => (f.phase === 'DONE' ? true : d.date < today))
    const kms = pastDays.map((_, i) => SEED_KM[i % SEED_KM.length])
    try {
      let session = await prisma.mobileTripSession.findUnique({ where: { driverId_bookingId: { driverId, bookingId: t.bookingId } } })
      if (!session) {
        session = await prisma.mobileTripSession.create({
          data: {
            driverId, bookingId: t.bookingId, bookingRef: t.bookingRef, country: country ?? 'SRILANKA',
            status: f.phase === 'DONE' ? 'COMPLETED' : 'ACTIVE',
            portalSkipped: true,
            startedAt: new Date(`${t.startDate}T02:30:00.000Z`),
            completedAt: f.phase === 'DONE' ? new Date(`${t.endDate}T14:00:00.000Z`) : null,
            feedbackStatus: f.phase === 'DONE' ? 'SUBMITTED' : null,
            totalKm: kms.reduce((a, b) => a + b, 0).toFixed(2),
          },
        })
        for (let i = 0; i < pastDays.length; i++) {
          const date = pastDays[i].date
          await prisma.mobileTripDay.create({
            data: {
              sessionId: session.id, driverId, bookingRef: t.bookingRef, dayDate: date, status: 'ENDED',
              startedAt: new Date(`${date}T02:30:00.000Z`), endedAt: new Date(`${date}T12:30:00.000Z`),
              distanceKm: kms[i].toFixed(3),
            },
          })
        }
      }
    } catch (err) {
      // Another request seeded it at the same moment — fine.
      if ((err as { code?: string }).code !== 'P2002') throw err
    }
  }
  seeded.add(key)
}

/**
 * The test driver's trips touching [from, to], or null when this is a real
 * driver (then the caller loads real trips).
 */
export async function sandboxTrips(driverId: string, from: string, to: string, todayFor: (country: string | null) => string): Promise<DriverTrip[] | null> {
  const info = await lookup(driverId)
  if (!info.sandbox) return null
  const today = todayFor(info.country)
  const monday = mondayOf(today)
  const all = fixturesFor(today).map(f => ({ f, t: toTrip(driverId, info.country, monday, f) }))
  await seed(driverId, info.country, monday, today, all)
  return all.map(x => x.t)
    .filter(t => t.endDate >= from && t.startDate <= to)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/** One test trip by ref (current week's set), or null for a real driver. undefined = sandbox, ref unknown. */
export async function sandboxTrip(driverId: string, bookingRef: string, todayFor: (country: string | null) => string): Promise<DriverTrip | null | undefined> {
  const trips = await sandboxTrips(driverId, '0000-01-01', '9999-12-31', todayFor)
  if (!trips) return null
  return trips.find(t => t.bookingRef === bookingRef)
}
