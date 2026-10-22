/**
 * Aahaas app — the vehicle vendor's side (fleet owners who log in with their
 * vendor-portal account).
 *
 * A vendor manages their own drivers and vehicles, pairs them up, puts a
 * driver + vehicle on the trips ops gave them, and requests open trips from
 * the Driver-Auto board. Their drivers sign in to the same app with a code
 * sent to the WhatsApp number the vendor typed in — and see only the trips
 * their vendor gives them (no open board for them).
 *
 * Live-DB safety — the same rows and rules as the vendor portal
 * (/vendor/dashboard, /api/vendor/*), and nothing more:
 *   • writes only `drivers`, `vehicles` and the driver/vehicle columns of
 *     `assignments`, every query scoped by `vendorId`
 *   • never deletes — a driver or vehicle is switched off, not removed, so no
 *     assignment, payment or allocation ever loses its row
 *   • never reads or returns a rate (`driverRate` is internal P&L only)
 *   • no new tables; driver-app state (codes, app accounts, live days) is
 *     read from the existing mobile_* tables, tolerating them being absent
 */
import type { BookingStatus, OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeEmail, phoneMatches } from '@/lib/credential-match'
import { detectCountryFromRef } from '@/lib/country-detection'
import { syncSlAllocationFromAgenda } from '@/lib/sl-driver-allocation-sync'
import { fileNumberOf } from '@/lib/driver-auto/shared'
import { MobileError, isMobileTableMissing } from './http'
import { issueOtp, whatsappNumberFor } from './otp'
import { notify } from './notify'
import { addDaysYmd, localTodayFor, ymd } from './trips'
import { SANDBOX_REF_PREFIX } from './sandbox'

/** Same list as the vendor portal's vehicle form. */
export const VEHICLE_TYPES = ['car', 'flatroof-van', 'highroof-van', 'van', 'minibus', 'bus-medium', 'bus-high', 'motorbike', 'other']

const DEAD_BOOKING: BookingStatus[] = ['CANCELLED', 'PENDING_CANCELLATION', 'AMENDED']

export interface VendorCtx { vendorId: string; name: string; country: string | null }

const log = (v: VendorCtx, what: string) => console.log(`[mobile vendor] ${v.name} (${v.vendorId}): ${what}`)

// ── Profile ──────────────────────────────────────────────────────────────────

function mask(acc: string | null): string | null {
  if (!acc) return null
  const s = acc.replace(/\s+/g, '')
  return s.length <= 4 ? s : `•••• ${s.slice(-4)}`
}

export async function vendorProfile(vendorId: string) {
  const v = await prisma.vehicleVendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true, name: true, email: true, phone: true, whatsappPhone: true, address: true, country: true,
      bankName: true, bankBranch: true, bankHolder: true, bankAccountNo: true,
    },
  })
  if (!v) return null
  return {
    kind: 'VENDOR' as const,
    id: v.id, name: v.name, email: v.email, phone: v.phone, whatsappPhone: v.whatsappPhone,
    address: v.address, country: v.country,
    bank: v.bankName || v.bankAccountNo
      ? { bankName: v.bankName, branch: v.bankBranch, holder: v.bankHolder, accountNo: mask(v.bankAccountNo) }
      : null,
  }
}

// ── Driver-app state of the fleet (read-only, mobile_* tables) ───────────────

export type AppStatus = 'ON_APP' | 'CODE_SENT' | 'NOT_JOINED'

interface AppState { status: AppStatus; lastSeenAt: string | null; platform: string | null; codeSentAt: string | null }
interface LiveDay { bookingRef: string; km: number; startedAt: string; lastPingAt: string | null }

async function appStates(ids: string[]): Promise<Map<string, AppState>> {
  const out = new Map<string, AppState>()
  if (!ids.length) return out
  try {
    const [accounts, codes] = await Promise.all([
      prisma.mobileDriverAccount.findMany({
        where: { driverId: { in: ids } },
        select: { driverId: true, passwordHash: true, lastLoginAt: true, lastSeenAt: true, platform: true },
      }),
      prisma.mobileOtp.findMany({
        where: { driverId: { in: ids }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        orderBy: { createdAt: 'desc' },
        select: { driverId: true, createdAt: true },
      }),
    ])
    for (const id of ids) {
      const a = accounts.find(x => x.driverId === id)
      const c = codes.find(x => x.driverId === id)
      const joined = !!a && (!!a.passwordHash || !!a.lastLoginAt)
      out.set(id, {
        status: joined ? 'ON_APP' : c ? 'CODE_SENT' : 'NOT_JOINED',
        lastSeenAt: (a?.lastSeenAt ?? a?.lastLoginAt)?.toISOString() ?? null,
        platform: a?.platform ?? null,
        codeSentAt: c?.createdAt.toISOString() ?? null,
      })
    }
  } catch (err) {
    if (!isMobileTableMissing(err)) throw err
  }
  return out
}

/** Days running right now (driver swiped "Start day" and has not ended it). */
async function liveDays(ids: string[]): Promise<Map<string, LiveDay>> {
  const out = new Map<string, LiveDay>()
  if (!ids.length) return out
  try {
    const rows = await prisma.mobileTripDay.findMany({
      where: { driverId: { in: ids }, status: 'STARTED', startedAt: { gte: new Date(Date.now() - 36 * 3_600_000) } },
      orderBy: { startedAt: 'desc' },
      select: { driverId: true, bookingRef: true, distanceKm: true, startedAt: true, lastPingAt: true },
    })
    for (const r of rows) {
      if (out.has(r.driverId) || r.bookingRef.startsWith(SANDBOX_REF_PREFIX)) continue
      out.set(r.driverId, {
        bookingRef: r.bookingRef, km: Math.round(Number(r.distanceKm) * 10) / 10,
        startedAt: r.startedAt.toISOString(), lastPingAt: r.lastPingAt?.toISOString() ?? null,
      })
    }
  } catch (err) {
    if (!isMobileTableMissing(err)) throw err
  }
  return out
}

// ── Drivers ──────────────────────────────────────────────────────────────────

export async function listDrivers(v: VendorCtx) {
  const today = localTodayFor(v.country)
  const drivers = await prisma.driver.findMany({
    where: { vendorId: v.vendorId },
    select: {
      id: true, name: true, phone: true, email: true, licenseNo: true, photoUrl: true, isActive: true, country: true,
      vehicle: { select: { id: true, plateNo: true, type: true, brand: true, model: true, capacity: true, photoOutside: true, isActive: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
  const ids = drivers.map(d => d.id)
  const [app, live, upcoming] = await Promise.all([
    appStates(ids),
    liveDays(ids),
    ids.length
      ? prisma.assignment.findMany({
          where: {
            driverId: { in: ids },
            agendaItem: { date: { gte: new Date(`${today}T00:00:00.000Z`) }, agenda: { booking: { status: { notIn: DEAD_BOOKING } } } },
          },
          select: {
            driverId: true,
            agendaItem: { select: { date: true, location: true, fromPoint: true, toPoint: true, agenda: { select: { booking: { select: { bookingRef: true, isNumber: true, cntlNumber: true } } } } } },
          },
          orderBy: { agendaItem: { date: 'asc' } },
          take: 2000,
        })
      : Promise.resolve([]),
  ])
  return drivers.map(d => {
    const mine = upcoming.filter(u => u.driverId === d.id)
    const first = mine[0]?.agendaItem
    return {
      ...d,
      whatsapp: d.phone,
      app: app.get(d.id) ?? null,
      live: live.get(d.id) ?? null,
      upcomingTrips: new Set(mine.map(m => m.agendaItem.agenda.booking.bookingRef)).size,
      nextTrip: first
        ? { date: ymd(first.date), fileNo: fileNumberOf(first.agenda.booking), route: [first.fromPoint || first.location, first.toPoint].filter(Boolean).join(' → ') }
        : null,
    }
  })
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 2) throw new MobileError('Type the driver’s full name.')
  return name.slice(0, 120)
}

/** "+94771234567" — the international form WhatsApp and the sign-in code need. */
function cleanWhatsapp(raw: unknown, country: string | null): string {
  const n = whatsappNumberFor(String(raw ?? '').trim(), country)
  if (!n) throw new MobileError('Type the driver’s WhatsApp number with the country code, e.g. +94 77 123 4567.', 400, 'bad_phone')
  return `+${n}`
}

function cleanEmail(raw: unknown): string | null {
  const e = normalizeEmail(String(raw ?? ''))
  if (!e) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new MobileError('That e-mail address does not look right.')
  return e.slice(0, 190)
}

function cleanUpload(raw: unknown): string | null {
  const u = String(raw ?? '').trim()
  if (!u) return null
  if (!u.startsWith('/api/uploads/') && !/^https:\/\//.test(u)) throw new MobileError('Upload the photo first.')
  return u.slice(0, 1000)
}

/**
 * A WhatsApp number is how a driver signs in, so it must point at exactly one
 * driver — otherwise a code could open someone else's account.
 */
async function assertNumberFree(v: VendorCtx, phone: string, exceptId?: string) {
  const rows = await prisma.driver.findMany({ select: { id: true, name: true, phone: true, vendorId: true } })
  const hit = rows.find(r => r.id !== exceptId && phoneMatches(r.phone, phone))
  if (!hit) return
  throw new MobileError(
    hit.vendorId === v.vendorId
      ? `${hit.name} in your fleet already uses this WhatsApp number.`
      : 'This WhatsApp number already belongs to a registered driver. Ask operations to move that driver to your fleet.',
    409, 'number_taken',
  )
}

async function ownDriver(v: VendorCtx, id: string) {
  const d = await prisma.driver.findFirst({
    where: { id, vendorId: v.vendorId },
    select: { id: true, name: true, phone: true, email: true, country: true, isActive: true, vehicleId: true },
  })
  if (!d) throw new MobileError('That driver is not in your fleet.', 404, 'not_found')
  return d
}

async function ownVehicle(v: VendorCtx, id: string) {
  const veh = await prisma.vehicle.findFirst({ where: { id, vendorId: v.vendorId }, select: { id: true, plateNo: true, type: true, capacity: true, isActive: true } })
  if (!veh) throw new MobileError('That vehicle is not in your fleet.', 404, 'not_found')
  return veh
}

export interface CodeResult { sent: boolean; to: string | null; error: string | null }

/** Sends the driver a 6-digit sign-in code on WhatsApp (the approved AUTHENTICATION template). */
export async function sendDriverCode(v: VendorCtx, driverId: string): Promise<CodeResult> {
  const d = await ownDriver(v, driverId)
  if (!d.isActive) throw new MobileError('Switch this driver on first.', 409, 'inactive')
  try {
    const issued = await issueOtp({ driver: { ...d, country: d.country ?? v.country }, purpose: 'ACTIVATE', channel: 'WHATSAPP', ip: null })
    log(v, `sent app code to driver ${d.name}`)
    return { sent: true, to: issued.sentTo, error: null }
  } catch (err) {
    if (isMobileTableMissing(err)) return { sent: false, to: null, error: 'The driver app is not switched on for this server yet.' }
    if (err instanceof MobileError) return { sent: false, to: null, error: err.message }
    throw err
  }
}

export interface DriverInput {
  name?: unknown; whatsapp?: unknown; email?: unknown; licenseNo?: unknown; photoUrl?: unknown
  vehicleId?: string | null; isActive?: boolean; sendCode?: boolean
}

export async function createDriver(v: VendorCtx, input: DriverInput) {
  const name = cleanName(input.name)
  const phone = cleanWhatsapp(input.whatsapp, v.country)
  await assertNumberFree(v, phone)
  const vehicle = input.vehicleId ? await ownVehicle(v, input.vehicleId) : null
  if (vehicle && !vehicle.isActive) throw new MobileError('That vehicle is switched off.')

  const driver = await prisma.$transaction(async tx => {
    // drivers.vehicleId is unique — one vehicle, one driver.
    if (vehicle) await tx.driver.updateMany({ where: { vehicleId: vehicle.id }, data: { vehicleId: null } })
    return tx.driver.create({
      data: {
        name, phone,
        email: cleanEmail(input.email),
        licenseNo: String(input.licenseNo ?? '').trim().toUpperCase().slice(0, 60) || null,
        photoUrl: cleanUpload(input.photoUrl),
        isActive: true,
        country: (v.country as OperationCountry | null) ?? null,
        vendorId: v.vendorId,
        vehicleId: vehicle?.id ?? null,
      },
      select: { id: true, name: true },
    })
  })
  log(v, `added driver ${driver.name}`)
  const code = input.sendCode ? await sendDriverCode(v, driver.id) : null
  return { id: driver.id, code }
}

export async function updateDriver(v: VendorCtx, id: string, input: DriverInput) {
  const d = await ownDriver(v, id)
  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = cleanName(input.name)
  if (input.email !== undefined) data.email = cleanEmail(input.email)
  if (input.licenseNo !== undefined) data.licenseNo = String(input.licenseNo ?? '').trim().toUpperCase().slice(0, 60) || null
  if (input.photoUrl !== undefined) data.photoUrl = cleanUpload(input.photoUrl)

  let numberChanged = false
  if (input.whatsapp !== undefined) {
    const phone = cleanWhatsapp(input.whatsapp, d.country ?? v.country)
    if (!phoneMatches(phone, d.phone)) {
      await assertNumberFree(v, phone, d.id)
      data.phone = phone
      numberChanged = true
    }
  }

  if (input.isActive === false && d.isActive) {
    const today = localTodayFor(d.country ?? v.country)
    const upcoming = await prisma.assignment.count({
      where: { driverId: d.id, agendaItem: { date: { gte: new Date(`${today}T00:00:00.000Z`) }, agenda: { booking: { status: { notIn: DEAD_BOOKING } } } } },
    })
    if (upcoming) throw new MobileError(`${d.name} still has ${upcoming} upcoming movement${upcoming === 1 ? '' : 's'}. Give them to another driver first.`, 409, 'has_trips')
    data.isActive = false
  } else if (input.isActive === true) data.isActive = true

  const vehicle = input.vehicleId ? await ownVehicle(v, input.vehicleId) : null
  if (vehicle && !vehicle.isActive) throw new MobileError('That vehicle is switched off.')

  await prisma.$transaction(async tx => {
    if (input.vehicleId !== undefined) {
      if (vehicle) await tx.driver.updateMany({ where: { vehicleId: vehicle.id, id: { not: d.id } }, data: { vehicleId: null } })
      data.vehicleId = vehicle?.id ?? null
    }
    if (Object.keys(data).length) await tx.driver.update({ where: { id: d.id }, data })
  })

  // The number is where sign-in codes go: a new number signs the old phone out.
  if (numberChanged) {
    await prisma.mobileDriverAccount.updateMany({ where: { driverId: d.id }, data: { tokenVersion: { increment: 1 } } })
      .catch(err => { if (!isMobileTableMissing(err)) throw err })
  }
  log(v, `updated driver ${d.name}: ${Object.keys(data).join(', ') || 'nothing'}`)
  return { id: d.id }
}

// ── Vehicles ─────────────────────────────────────────────────────────────────

export async function listVehicles(v: VendorCtx) {
  const today = localTodayFor(v.country)
  const vehicles = await prisma.vehicle.findMany({
    where: { vendorId: v.vendorId },
    select: {
      id: true, type: true, plateNo: true, brand: true, model: true, capacity: true,
      photoOutside: true, photoInside: true, isActive: true,
      driver: { select: { id: true, name: true, phone: true, photoUrl: true, isActive: true } },
    },
    orderBy: [{ isActive: 'desc' }, { plateNo: 'asc' }],
  })
  const plates = vehicles.map(x => x.plateNo)
  const upcoming = plates.length
    ? await prisma.assignment.findMany({
        where: {
          vendorId: v.vendorId, vehiclePlate: { in: plates },
          agendaItem: { date: { gte: new Date(`${today}T00:00:00.000Z`) }, agenda: { booking: { status: { notIn: DEAD_BOOKING } } } },
        },
        select: { vehiclePlate: true, agendaItem: { select: { agenda: { select: { bookingId: true } } } } },
        take: 2000,
      })
    : []
  return vehicles.map(x => ({
    ...x,
    upcomingTrips: new Set(upcoming.filter(u => u.vehiclePlate === x.plateNo).map(u => u.agendaItem.agenda.bookingId)).size,
  }))
}

function cleanPlate(raw: unknown): string {
  const p = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (p.length < 3) throw new MobileError('Type the number plate.')
  return p.slice(0, 20)
}

function cleanCapacity(raw: unknown): number {
  const n = parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n < 1 || n > 80) throw new MobileError('Seats must be between 1 and 80.')
  return n
}

async function assertPlateFree(v: VendorCtx, plate: string, exceptId?: string) {
  const hit = await prisma.vehicle.findUnique({ where: { plateNo: plate }, select: { id: true, vendorId: true } })
  if (!hit || hit.id === exceptId) return
  throw new MobileError(
    hit.vendorId === v.vendorId ? `${plate} is already in your fleet.` : `${plate} is registered to another fleet. Ask operations if it is yours.`,
    409, 'plate_taken',
  )
}

export interface VehicleInput {
  type?: unknown; plateNo?: unknown; brand?: unknown; model?: unknown; capacity?: unknown
  photoOutside?: unknown; photoInside?: unknown; isActive?: boolean; driverId?: string | null
}

const cleanType = (raw: unknown) => (VEHICLE_TYPES.includes(String(raw)) ? String(raw) : 'car')
const cleanText = (raw: unknown, max = 60) => String(raw ?? '').trim().slice(0, max) || null

export async function createVehicle(v: VendorCtx, input: VehicleInput) {
  const plateNo = cleanPlate(input.plateNo)
  await assertPlateFree(v, plateNo)
  const driver = input.driverId ? await ownDriver(v, input.driverId) : null
  try {
    const vehicle = await prisma.$transaction(async tx => {
      const created = await tx.vehicle.create({
        data: {
          type: cleanType(input.type), plateNo,
          brand: cleanText(input.brand), model: cleanText(input.model),
          capacity: cleanCapacity(input.capacity ?? 4),
          photoOutside: cleanUpload(input.photoOutside), photoInside: cleanUpload(input.photoInside),
          vendorId: v.vendorId,
        },
        select: { id: true, plateNo: true },
      })
      if (driver) await tx.driver.update({ where: { id: driver.id }, data: { vehicleId: created.id } })
      return created
    })
    log(v, `added vehicle ${vehicle.plateNo}`)
    return { id: vehicle.id }
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw new MobileError(`${plateNo} is already registered.`, 409, 'plate_taken')
    throw err
  }
}

export async function updateVehicle(v: VendorCtx, id: string, input: VehicleInput) {
  const veh = await ownVehicle(v, id)
  const data: Record<string, unknown> = {}
  if (input.type !== undefined) data.type = cleanType(input.type)
  if (input.brand !== undefined) data.brand = cleanText(input.brand)
  if (input.model !== undefined) data.model = cleanText(input.model)
  if (input.capacity !== undefined) data.capacity = cleanCapacity(input.capacity)
  if (input.photoOutside !== undefined) data.photoOutside = cleanUpload(input.photoOutside)
  if (input.photoInside !== undefined) data.photoInside = cleanUpload(input.photoInside)
  if (input.plateNo !== undefined) {
    const plate = cleanPlate(input.plateNo)
    if (plate !== veh.plateNo) { await assertPlateFree(v, plate, veh.id); data.plateNo = plate }
  }
  if (typeof input.isActive === 'boolean') data.isActive = input.isActive
  const driver = input.driverId ? await ownDriver(v, input.driverId) : null
  if (driver && !driver.isActive) throw new MobileError(`${driver.name} is switched off.`)

  try {
    await prisma.$transaction(async tx => {
      // A switched-off vehicle leaves its driver free for another one.
      if (input.driverId !== undefined || input.isActive === false) {
        await tx.driver.updateMany({ where: { vehicleId: veh.id }, data: { vehicleId: null } })
      }
      if (driver && input.isActive !== false) await tx.driver.update({ where: { id: driver.id }, data: { vehicleId: veh.id } })
      if (Object.keys(data).length) await tx.vehicle.update({ where: { id: veh.id }, data })
    })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw new MobileError('That number plate is already registered.', 409, 'plate_taken')
    throw err
  }
  log(v, `updated vehicle ${veh.plateNo}: ${[...Object.keys(data), ...(input.driverId !== undefined ? ['driver'] : [])].join(', ') || 'nothing'}`)
  return { id: veh.id }
}

// ── Trips the vendor holds ───────────────────────────────────────────────────

/** Sri Lanka runs one driver for the whole tour; SG / MY / VN allocate per movement. */
function isWholeBooking(country: string | null, bookingRef: string) {
  return (country ?? detectCountryFromRef(bookingRef)) === 'SRILANKA'
}

export type JobState = 'NEEDS_DRIVER' | 'NEEDS_VEHICLE' | 'READY' | 'LIVE' | 'DONE'

export async function vendorJobs(v: VendorCtx, fromYmd: string, toYmd: string) {
  const today = localTodayFor(v.country)
  const rows = await prisma.assignment.findMany({
    where: {
      vendorId: v.vendorId,
      agendaItem: {
        date: { gte: new Date(`${fromYmd}T00:00:00.000Z`), lte: new Date(`${toYmd}T23:59:59.999Z`) },
        agenda: { booking: { status: { notIn: DEAD_BOOKING } } },
      },
    },
    // Never the rate: driverRate / rateCurrency stay internal.
    select: {
      id: true, driverId: true, driverName: true, driverPhone: true, vehiclePlate: true, vehicleType: true, notes: true,
      driver: { select: { id: true, name: true, phone: true, photoUrl: true } },
      agendaItem: {
        select: {
          id: true, date: true, location: true, fromPoint: true, toPoint: true, meetingTime: true, timeFrom: true, timeTo: true,
          serviceType: true, isLeisure: true, isHotelOnly: true, sortOrder: true,
          agenda: {
            select: {
              bookingId: true,
              booking: { select: { bookingRef: true, isNumber: true, cntlNumber: true, dealName: true, paxAdults: true, paxChildren: true, operationCountry: true } },
            },
          },
        },
      },
    },
    orderBy: [{ agendaItem: { date: 'asc' } }, { agendaItem: { sortOrder: 'asc' } }],
    take: 1500,
  })

  const driverIds = Array.from(new Set(rows.map(r => r.driverId).filter((x): x is string => !!x)))
  const live = await liveDays(driverIds)

  type Row = (typeof rows)[number]
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const b = r.agendaItem.agenda.booking
    const key = isWholeBooking(b.operationCountry, b.bookingRef) ? `B:${r.agendaItem.agenda.bookingId}` : `M:${r.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  return Array.from(groups.entries()).map(([key, list]) => {
    const b = list[0].agendaItem.agenda.booking
    const dates = list.map(r => ymd(r.agendaItem.date))
    const startDate = dates[0]
    const endDate = dates[dates.length - 1]
    const withDriver = list.find(r => r.driverId || r.driverName)
    const driverIdsHere = new Set(list.map(r => r.driverId ?? r.driverName ?? ''))
    const driver = withDriver
      ? { id: withDriver.driverId, name: withDriver.driver?.name ?? withDriver.driverName ?? 'Driver', phone: withDriver.driver?.phone ?? withDriver.driverPhone, photoUrl: withDriver.driver?.photoUrl ?? null }
      : null
    const withVehicle = list.find(r => r.vehiclePlate)
    const running = driver?.id ? live.get(driver.id) : undefined
    const liveNow = running && running.bookingRef === b.bookingRef ? running : null
    const state: JobState = endDate < today ? 'DONE'
      : liveNow ? 'LIVE'
      : !driver ? 'NEEDS_DRIVER'
      : !withVehicle ? 'NEEDS_VEHICLE'
      : 'READY'
    return {
      id: list[0].id,
      key,
      bookingRef: b.bookingRef,
      fileNo: fileNumberOf(b),
      title: b.dealName?.trim() || null,
      country: b.operationCountry ?? detectCountryFromRef(b.bookingRef),
      wholeBooking: key.startsWith('B:'),
      startDate, endDate,
      pax: { adults: b.paxAdults, children: b.paxChildren },
      legs: list.map(r => ({
        assignmentId: r.id,
        date: ymd(r.agendaItem.date),
        time: r.agendaItem.meetingTime || r.agendaItem.timeFrom || null,
        timeTo: r.agendaItem.timeTo ?? null,
        location: r.agendaItem.location,
        from: r.agendaItem.fromPoint, to: r.agendaItem.toPoint,
        serviceType: r.agendaItem.serviceType,
        noDriverNeeded: !!(r.agendaItem.isLeisure || r.agendaItem.isHotelOnly),
        driverName: r.driver?.name ?? r.driverName ?? null,
        vehiclePlate: r.vehiclePlate,
      })),
      driver,
      vehicle: withVehicle ? { plateNo: withVehicle.vehiclePlate!, type: withVehicle.vehicleType } : null,
      mixed: driverIdsHere.size > 1,
      notes: list.find(r => r.notes)?.notes ?? null,
      live: liveNow,
      state,
    }
  }).sort((a, b) => a.startDate.localeCompare(b.startDate))
}

export interface AssignInput { driverId?: string | null; vehicleId?: string | null; force?: boolean }

/**
 * Put a driver and/or vehicle on a trip the vendor holds — the movement only,
 * or every movement of the booking for a Sri Lanka tour (same rule as the
 * vendor portal). Picking a driver brings their own vehicle along unless a
 * vehicle is chosen. A clash or a too-small vehicle is answered with 409
 * `confirm`, and goes through when the vendor confirms (`force`).
 */
export async function assignJob(v: VendorCtx, assignmentId: string, input: AssignInput) {
  const a = await prisma.assignment.findFirst({
    where: { id: assignmentId, vendorId: v.vendorId },
    select: {
      id: true, driverId: true,
      agendaItem: { select: { agenda: { select: { bookingId: true, booking: { select: { bookingRef: true, isNumber: true, cntlNumber: true, operationCountry: true, paxAdults: true, paxChildren: true, status: true } } } } } },
    },
  })
  if (!a) throw new MobileError('That trip is not yours.', 404, 'not_found')
  const { bookingId, booking } = a.agendaItem.agenda
  if (DEAD_BOOKING.includes(booking.status)) throw new MobileError('This booking was cancelled or amended.', 409, 'dead')
  const whole = isWholeBooking(booking.operationCountry, booking.bookingRef)

  const targets = await prisma.assignment.findMany({
    where: whole ? { vendorId: v.vendorId, agendaItem: { agenda: { bookingId } } } : { id: a.id, vendorId: v.vendorId },
    select: { id: true, driverId: true, agendaItem: { select: { date: true } } },
  })
  const targetIds = targets.map(t => t.id)

  const driver = input.driverId
    ? await prisma.driver.findFirst({
        where: { id: input.driverId, vendorId: v.vendorId },
        select: { id: true, name: true, phone: true, isActive: true, vehicle: { select: { id: true, plateNo: true, type: true, capacity: true, isActive: true } } },
      })
    : null
  if (input.driverId && !driver) throw new MobileError('That driver is not in your fleet.', 404)
  if (driver && !driver.isActive) throw new MobileError(`${driver.name} is switched off.`)

  let vehicle: { plateNo: string; type: string; capacity: number } | null | undefined
  if (input.vehicleId !== undefined) {
    if (input.vehicleId) {
      const veh = await ownVehicle(v, input.vehicleId)
      if (!veh.isActive) throw new MobileError(`${veh.plateNo} is switched off.`)
      vehicle = veh
    } else vehicle = null
  } else if (driver?.vehicle?.isActive) {
    vehicle = driver.vehicle
  }

  if (!input.force) {
    const warnings: string[] = []
    if (driver) {
      const dates = Array.from(new Set(targets.map(t => ymd(t.agendaItem.date))))
      const others = await prisma.assignment.findMany({
        where: {
          driverId: driver.id, id: { notIn: targetIds },
          agendaItem: { date: { in: dates.map(d => new Date(`${d}T00:00:00.000Z`)) }, agenda: { bookingId: { not: bookingId }, booking: { status: { notIn: DEAD_BOOKING } } } },
        },
        select: { agendaItem: { select: { date: true, agenda: { select: { booking: { select: { bookingRef: true, isNumber: true, cntlNumber: true } } } } } } },
        take: 20,
      })
      const labels = Array.from(new Set(others.map(o => `${fileNumberOf(o.agendaItem.agenda.booking)} (${ymd(o.agendaItem.date)})`)))
      if (labels.length) warnings.push(`${driver.name} is already driving ${labels.slice(0, 4).join(', ')} on the same day.`)
    }
    const pax = booking.paxAdults + booking.paxChildren
    if (vehicle && vehicle.capacity < pax) warnings.push(`${vehicle.plateNo} seats ${vehicle.capacity}, but this trip has ${pax} guests.`)
    if (warnings.length) throw new MobileError(warnings.join('\n'), 409, 'confirm')
  }

  const data: Record<string, unknown> = {}
  if (input.driverId !== undefined) {
    data.driverId = driver?.id ?? null
    data.driverName = driver?.name ?? null
    data.driverPhone = driver?.phone ?? null
  }
  if (vehicle !== undefined) {
    data.vehiclePlate = vehicle?.plateNo ?? null
    data.vehicleType = vehicle?.type ?? null
  }
  if (!Object.keys(data).length) throw new MobileError('Choose a driver or a vehicle.')
  await prisma.assignment.updateMany({ where: { id: { in: targetIds }, vendorId: v.vendorId }, data })
  if (whole) await syncSlAllocationFromAgenda(bookingId).catch(err => console.error('[mobile vendor] SL sync', err))

  // Tell the drivers on their phones. Same dedupe key as the hourly sweep, so nobody hears twice.
  const fileNo = fileNumberOf(booking)
  const dates = targets.map(t => ymd(t.agendaItem.date)).sort()
  const when = dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`
  if (driver && !targets.every(t => t.driverId === driver.id)) {
    void notify({
      actorType: 'DRIVER', actorId: driver.id, kind: 'TRIP_ASSIGNED',
      title: `New trip · ${fileNo}`, body: `${when} · ${booking.paxAdults + booking.paxChildren} pax · from ${v.name}`,
      data: { bookingRef: booking.bookingRef, screen: 'trip' }, dedupeKey: `assigned:${driver.id}:${booking.bookingRef}`,
    }).catch(() => {})
  }
  if (input.driverId !== undefined) {
    for (const prev of Array.from(new Set(targets.map(t => t.driverId).filter((x): x is string => !!x && x !== driver?.id)))) {
      void notify({
        actorType: 'DRIVER', actorId: prev, kind: 'TRIP_REMOVED',
        title: `Trip changed · ${fileNo}`, body: `${v.name} gave ${when} to another driver.`, data: { screen: 'trips' },
      }).catch(() => {})
    }
  }
  log(v, `assigned ${booking.bookingRef} (${targetIds.length} movement(s)): ${driver?.name ?? (input.driverId === null ? 'no driver' : 'driver unchanged')} / ${vehicle === undefined ? 'vehicle unchanged' : vehicle?.plateNo ?? 'no vehicle'}`)
  return { updated: targetIds.length, wholeBooking: whole }
}

// ── Home ─────────────────────────────────────────────────────────────────────

export async function vendorHome(v: VendorCtx) {
  const today = localTodayFor(v.country)
  const [jobs, drivers, vehicles, pendingRequests] = await Promise.all([
    vendorJobs(v, addDaysYmd(today, -1), addDaysYmd(today, 21)),
    listDrivers(v),
    listVehicles(v),
    prisma.driverTripClaim.count({ where: { partyType: 'VENDOR', partyId: v.vendorId, status: 'PENDING' } }).catch(() => 0),
  ])
  const activeDrivers = drivers.filter(d => d.isActive)
  const activeVehicles = vehicles.filter(x => x.isActive)
  const open = jobs.filter(j => j.state !== 'DONE')
  const unassigned = open.filter(j => j.state === 'NEEDS_DRIVER' || j.state === 'NEEDS_VEHICLE')
  const notOnApp = activeDrivers.filter(d => d.app && d.app.status !== 'ON_APP')
  const noVehicle = activeDrivers.filter(d => !d.vehicle)
  const idle = activeVehicles.filter(x => !x.driver)

  const attention: { kind: string; tone: 'red' | 'gold' | 'blue'; title: string; body: string }[] = []
  if (!activeDrivers.length) attention.push({ kind: 'NO_DRIVERS', tone: 'red', title: 'Add your first driver', body: 'Add a driver with their WhatsApp number. They sign in with a code we send there.' })
  if (!activeVehicles.length) attention.push({ kind: 'NO_VEHICLES', tone: 'red', title: 'Add your first vehicle', body: 'Plate, seats and two photos. Then pair it with a driver.' })
  if (unassigned.length) attention.push({ kind: 'UNASSIGNED', tone: 'red', title: `${unassigned.length} trip${unassigned.length === 1 ? '' : 's'} need${unassigned.length === 1 ? 's' : ''} a driver or vehicle`, body: `First: ${unassigned[0].fileNo} on ${unassigned[0].startDate}.` })
  if (notOnApp.length) attention.push({ kind: 'NOT_ON_APP', tone: 'gold', title: `${notOnApp.length} driver${notOnApp.length === 1 ? ' is' : 's are'} not on the app yet`, body: 'Send them a sign-in code on WhatsApp.' })
  if (noVehicle.length && activeVehicles.length) attention.push({ kind: 'NO_VEHICLE', tone: 'blue', title: `${noVehicle.length} driver${noVehicle.length === 1 ? '' : 's'} without a vehicle`, body: noVehicle.slice(0, 3).map(d => d.name).join(', ') })
  if (idle.length && activeDrivers.length) attention.push({ kind: 'IDLE_VEHICLE', tone: 'blue', title: `${idle.length} vehicle${idle.length === 1 ? '' : 's'} without a driver`, body: idle.slice(0, 3).map(x => x.plateNo).join(', ') })

  return {
    today,
    counts: {
      drivers: activeDrivers.length, onApp: activeDrivers.filter(d => d.app?.status === 'ON_APP').length,
      vehicles: activeVehicles.length, liveNow: drivers.filter(d => d.live).length,
      upcoming: open.length, unassigned: unassigned.length,
    },
    live: drivers.filter(d => d.live).map(d => ({ driverId: d.id, name: d.name, photoUrl: d.photoUrl, plateNo: d.vehicle?.plateNo ?? null, ...d.live! })),
    todayJobs: open.filter(j => j.startDate <= today && j.endDate >= today),
    next: open.filter(j => j.startDate > today).slice(0, 5),
    attention,
    pendingRequests,
  }
}
