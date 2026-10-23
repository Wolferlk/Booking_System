/**
 * Self-registration in the Aahaas app — new independent drivers and new
 * vehicle vendors — and the ops approval that lets them in.
 *
 * Live-DB safety: no new tables or columns.
 *   DRIVER  one transaction creates the `drivers` row switched OFF (exactly
 *           like /register/driver), an optional `vehicles` row also OFF, the
 *           app login (`mobile_driver_accounts`, with their password) and a
 *           `mobile_driver_requests` row of kind SIGNUP. The SIGNUP row is what
 *           tells "waiting for approval" apart from "switched off by ops".
 *           Approve on /dashboard/ground/drivers switches the driver (and the
 *           vehicle they registered) on; Decline leaves both off. Nothing is
 *           ever deleted here.
 *   VENDOR  the same row the vendor portal's register page makes
 *           (lib/vendor-register.ts); ops approve on /dashboard/ground/vendors
 *           by switching the vendor on.
 *
 * Drivers a vendor adds to their own fleet never come through here — they are
 * active straight away (lib/mobile/vendor.ts).
 */
import bcrypt from 'bcryptjs'
import { Prisma, type OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeEmail, phoneMatches } from '@/lib/credential-match'
import { sendMailViaGraph } from '@/lib/send-mail'
import type { SignupStatus } from '@/lib/vendor-register'
import { MobileError, isMobileTableMissing } from './http'
import { whatsappNumberFor } from './otp'
import { notify, notifyStaff } from './notify'
import { VEHICLE_TYPES } from './vendor'

/** `mobile_driver_requests.kind` of a driver's own registration. */
export const SIGNUP = 'SIGNUP'

export const DRIVER_COUNTRIES: OperationCountry[] = ['SRILANKA', 'VIETNAM', 'SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA']

/** Registrations of one kind accepted per hour, server-wide — a brake on scripted sign-ups. */
const HOURLY_LIMIT = 30

export interface Decider { userId?: string; name: string }

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

async function mailRegistrant(to: string | null | undefined, subject: string, heading: string, lines: string[]): Promise<void> {
  const address = normalizeEmail(to)
  if (!address || !address.includes('@')) return
  try {
    await sendMailViaGraph({
      to: address,
      subject,
      bodyHtml: `
        <div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
          <h2 style="margin:0 0 12px;color:#111">${escapeHtml(heading)}</h2>
          ${lines.map(l => `<p style="color:#444;line-height:1.5">${escapeHtml(l)}</p>`).join('')}
          <p style="color:#999;font-size:12px;margin-top:20px">Aahaas · AppleHolidays Operations</p>
        </div>`,
    })
  } catch (err) {
    console.error('[mobile signup] e-mail failed:', err instanceof Error ? err.message : err)
  }
}

// ── Driver registration ─────────────────────────────────────────────────────

export interface DriverSignupInput {
  name?: unknown; phone?: unknown; email?: unknown; country?: unknown; licenseNo?: unknown; password?: unknown
  vehicle?: { type?: unknown; plateNo?: unknown; brand?: unknown; model?: unknown; capacity?: unknown } | null
}

function checkPassword(raw: unknown): string {
  const password = String(raw ?? '')
  if (password.length < 6) throw new MobileError('Use at least 6 characters for your password.', 400, 'weak')
  if (/^(\d)\1+$/.test(password) || password === '123456') throw new MobileError('That password is too easy to guess.', 400, 'weak')
  return password
}

function cleanEmail(raw: unknown): string | null {
  const e = normalizeEmail(String(raw ?? ''))
  if (!e) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new MobileError('That e-mail address does not look right.')
  return e.slice(0, 190)
}

function cleanVehicle(raw: DriverSignupInput['vehicle']) {
  if (!raw) return null
  const plateNo = String(raw.plateNo ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (!plateNo) return null
  if (plateNo.length < 3) throw new MobileError('Type the vehicle’s number plate.')
  const capacity = parseInt(String(raw.capacity ?? '4'), 10)
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > 80) throw new MobileError('Seats must be between 1 and 80.')
  const text = (v: unknown) => String(v ?? '').trim().slice(0, 60) || null
  return {
    plateNo: plateNo.slice(0, 20),
    type: VEHICLE_TYPES.includes(String(raw.type)) ? String(raw.type) : 'car',
    brand: text(raw.brand),
    model: text(raw.model),
    capacity,
  }
}

async function hasPendingSignup(driverId: string): Promise<boolean> {
  const r = await prisma.mobileDriverRequest.findFirst({ where: { driverId, kind: SIGNUP, status: 'PENDING' }, select: { id: true } })
  return !!r
}

/** App registration of an independent driver. Returns the new (switched-off) driver. */
export async function registerDriver(input: DriverSignupInput): Promise<{ driverId: string; name: string; phone: string }> {
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 2) throw new MobileError('Type your full name.')
  const country = DRIVER_COUNTRIES.includes(input.country as OperationCountry) ? (input.country as OperationCountry) : null
  if (!country) throw new MobileError('Choose the country you drive in.')
  const msisdn = whatsappNumberFor(String(input.phone ?? '').trim(), country)
  if (!msisdn) throw new MobileError('Type your WhatsApp number with the country code, e.g. +94 77 123 4567.', 400, 'bad_phone')
  const phone = `+${msisdn}`
  const email = cleanEmail(input.email)
  const licenseNo = String(input.licenseNo ?? '').trim().toUpperCase().slice(0, 60) || null
  const password = checkPassword(input.password)
  const vehicle = cleanVehicle(input.vehicle)

  const recent = await prisma.mobileDriverRequest.count({ where: { kind: SIGNUP, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })
  if (recent >= HOURLY_LIMIT) throw new MobileError('Too many registrations right now. Please try again in an hour.', 429, 'rate_limited')

  // The phone number is the driver's sign-in, so it must point at exactly one driver.
  const rows = await prisma.driver.findMany({ select: { id: true, phone: true, email: true } })
  const sameNumber = rows.find(r => phoneMatches(r.phone, phone))
  if (sameNumber) {
    throw await hasPendingSignup(sameNumber.id)
      ? new MobileError('You have already registered with this number and it is waiting for approval. Operations will let you know.', 409, 'already_pending')
      : new MobileError('This WhatsApp number is already registered as a driver. Sign in instead — or ask operations if you cannot get in.', 409, 'number_taken')
  }
  if (email && rows.some(r => normalizeEmail(r.email) === email)) {
    throw new MobileError('This e-mail already belongs to a registered driver. Use another one, or leave it empty.', 409, 'email_taken')
  }
  if (vehicle && await prisma.vehicle.findUnique({ where: { plateNo: vehicle.plateNo }, select: { id: true } })) {
    throw new MobileError(`${vehicle.plateNo} is already registered with us. If it is yours, register without the vehicle and tell operations.`, 409, 'plate_taken')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  let created: { id: string; name: string }
  try {
    created = await prisma.$transaction(async tx => {
      const veh = vehicle
        ? await tx.vehicle.create({ data: { ...vehicle, isActive: false }, select: { id: true } })
        : null
      const d = await tx.driver.create({
        data: { name: name.slice(0, 120), phone, email, licenseNo, country, isActive: false, vehicleId: veh?.id ?? null },
        select: { id: true, name: true },
      })
      await tx.mobileDriverAccount.create({ data: { driverId: d.id, passwordHash } })
      await tx.mobileDriverRequest.create({
        data: {
          driverId: d.id, driverName: d.name, kind: SIGNUP,
          payload: { source: 'APP', phone, email, country, licenseNo, vehicleId: veh?.id ?? null, vehicle } as Prisma.InputJsonValue,
        },
      })
      return d
    })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      throw new MobileError('Some of these details are already registered. Check them, or ask operations.', 409, 'exists')
    }
    throw err
  }

  console.log(`[mobile signup] driver ${created.name} (${created.id}) registered from the app — waiting for approval`)
  await notifyStaff(country, {
    kind: 'DRIVER_SIGNUP',
    title: `New driver registration · ${created.name}`,
    body: `${phone}${vehicle ? ` · ${vehicle.plateNo}` : ''} — approve it on Drivers & Vehicles.`,
    data: { driverId: created.id },
    dedupeKey: `signup:${created.id}`,
  }).catch(err => console.error('[mobile signup] staff notify', err))
  return { driverId: created.id, name: created.name, phone }
}

/**
 * The public web form (/register/driver) makes the driver itself; this files the
 * SIGNUP marker beside it so the registration shows up for approval too.
 * Best effort — the web registration has already succeeded.
 */
export async function recordWebDriverSignup(d: { id: string; name: string; phone: string; email: string | null; country: string | null; vehicleId: string | null }): Promise<void> {
  try {
    await prisma.mobileDriverRequest.create({
      data: {
        driverId: d.id, driverName: d.name, kind: SIGNUP,
        payload: { source: 'WEB', phone: d.phone, email: d.email, country: d.country, vehicleId: d.vehicleId } as Prisma.InputJsonValue,
      },
    })
    await notifyStaff(d.country, {
      kind: 'DRIVER_SIGNUP',
      title: `New driver registration · ${d.name}`,
      body: `${d.phone} — approve it on Drivers & Vehicles.`,
      data: { driverId: d.id },
      dedupeKey: `signup:${d.id}`,
    })
  } catch (err) {
    if (!isMobileTableMissing(err)) console.error('[mobile signup] web marker', err)
  }
}

// ── Ops: list / approve / decline ───────────────────────────────────────────

export interface DriverSignupRow {
  id: string
  driverId: string
  name: string
  phone: string
  email: string | null
  licenseNo: string | null
  country: string | null
  photoUrl: string | null
  source: 'APP' | 'WEB'
  vehicle: { id: string; type: string; plateNo: string; brand: string | null; model: string | null; capacity: number } | null
  submittedAt: string
}

/** Independent drivers waiting for approval, inside the viewer's country scope (null = all). */
export async function listDriverSignups(scope: OperationCountry[] | null): Promise<{ setupRequired: boolean; items: DriverSignupRow[] }> {
  let rows
  try {
    rows = await prisma.mobileDriverRequest.findMany({
      where: { kind: SIGNUP, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 200,
      select: { id: true, driverId: true, payload: true, createdAt: true },
    })
  } catch (err) {
    if (isMobileTableMissing(err)) return { setupRequired: true, items: [] }
    throw err
  }
  if (!rows.length) return { setupRequired: false, items: [] }
  const drivers = await prisma.driver.findMany({
    where: { id: { in: rows.map(r => r.driverId) } },
    select: {
      id: true, name: true, phone: true, email: true, licenseNo: true, country: true, photoUrl: true, isActive: true, vendorId: true,
      vehicle: { select: { id: true, type: true, plateNo: true, brand: true, model: true, capacity: true } },
    },
  })
  const byId = new Map(drivers.map(d => [d.id, d]))
  const items: DriverSignupRow[] = []
  for (const r of rows) {
    const d = byId.get(r.driverId)
    // Deleted, already switched on, or moved into a vendor's fleet: nothing left to approve here.
    if (!d || d.isActive || d.vendorId) continue
    if (scope && d.country && !scope.includes(d.country)) continue
    const p = (r.payload ?? {}) as Record<string, unknown>
    items.push({
      id: r.id, driverId: d.id, name: d.name, phone: d.phone, email: d.email, licenseNo: d.licenseNo,
      country: d.country, photoUrl: d.photoUrl, source: p.source === 'WEB' ? 'WEB' : 'APP',
      vehicle: d.vehicle, submittedAt: r.createdAt.toISOString(),
    })
  }
  return { setupRequired: false, items }
}

export async function approveDriverSignup(requestId: string, by: Decider, note?: string | null) {
  const r = await prisma.mobileDriverRequest.findUnique({ where: { id: requestId } })
  if (!r || r.kind !== SIGNUP) throw new MobileError('Registration not found.', 404, 'not_found')
  if (r.status !== 'PENDING') throw new MobileError('This registration was already answered.', 409, 'answered')
  const d = await prisma.driver.findUnique({ where: { id: r.driverId }, select: { id: true, name: true, phone: true, email: true, vehicleId: true } })
  if (!d) throw new MobileError('This driver has been deleted.', 404, 'not_found')
  // Only the vehicle they registered with — never a vehicle ops switched off on purpose.
  const p = (r.payload ?? {}) as Record<string, unknown>
  const ownVehicle = d.vehicleId && p.vehicleId === d.vehicleId ? d.vehicleId : null

  await prisma.$transaction(async tx => {
    // Conditional on PENDING, so two people pressing Approve at once is one approval.
    const n = await tx.mobileDriverRequest.updateMany({
      where: { id: r.id, status: 'PENDING' },
      data: { status: 'APPROVED', decidedByName: by.name.slice(0, 190), decidedAt: new Date(), decisionNote: note?.trim().slice(0, 1000) || null },
    })
    if (!n.count) throw new MobileError('This registration was already answered.', 409, 'answered')
    await tx.driver.update({ where: { id: d.id }, data: { isActive: true } })
    if (ownVehicle) await tx.vehicle.update({ where: { id: ownVehicle }, data: { isActive: true } })
  })
  console.log(`[mobile signup] driver ${d.name} (${d.id}) approved by ${by.name}`)

  await notify({
    actorType: 'DRIVER', actorId: d.id, kind: 'SIGNUP_APPROVED',
    title: 'You are approved ✅',
    body: 'Welcome to Aahaas! Sign in as Driver with your WhatsApp number and password.',
    data: { requestId: r.id },
    dedupeKey: `signup-decided:${r.id}`,
  }).catch(err => console.error('[mobile signup] approve notify', err))
  await mailRegistrant(d.email, 'Your Aahaas driver registration is approved', `Welcome, ${d.name.split(' ')[0]}!`, [
    'Your driver registration has been approved by the operations team.',
    `Open the Aahaas app, tap Driver and sign in with ${d.phone} and the password you chose.`,
  ])
  return { driverId: d.id, name: d.name }
}

export async function declineDriverSignup(requestId: string, by: Decider, note: string | null) {
  const r = await prisma.mobileDriverRequest.findUnique({ where: { id: requestId } })
  if (!r || r.kind !== SIGNUP) throw new MobileError('Registration not found.', 404, 'not_found')
  const reason = note?.trim().slice(0, 1000) || null
  const n = await prisma.mobileDriverRequest.updateMany({
    where: { id: r.id, status: 'PENDING' },
    data: { status: 'REJECTED', decidedByName: by.name.slice(0, 190), decidedAt: new Date(), decisionNote: reason },
  })
  if (!n.count) throw new MobileError('This registration was already answered.', 409, 'answered')
  const d = await prisma.driver.findUnique({ where: { id: r.driverId }, select: { id: true, name: true, email: true } })
  console.log(`[mobile signup] driver ${r.driverName} (${r.driverId}) declined by ${by.name}`)

  if (d) {
    await notify({
      actorType: 'DRIVER', actorId: d.id, kind: 'SIGNUP_DECLINED',
      title: 'Your registration was not approved',
      body: reason || 'Please contact operations for details.',
      data: { requestId: r.id },
      dedupeKey: `signup-decided:${r.id}`,
    }).catch(err => console.error('[mobile signup] decline notify', err))
    await mailRegistrant(d.email, 'Your Aahaas driver registration', `Hi ${d.name.split(' ')[0]},`, [
      'Your driver registration was not approved.',
      ...(reason ? [`Reason: ${reason}`] : []),
      'Please contact the operations team if you have questions.',
    ])
  }
  return { driverId: r.driverId }
}

/**
 * A pending driver switched on some other way (the Active box in the edit form)
 * is an approval too — settle the SIGNUP row so the app and the list agree.
 */
export async function settleSignupOnActivation(driverId: string, by: Decider): Promise<void> {
  try {
    const r = await prisma.mobileDriverRequest.findFirst({ where: { driverId, kind: SIGNUP, status: 'PENDING' }, select: { id: true } })
    if (r) await approveDriverSignup(r.id, by)
  } catch (err) {
    if (isMobileTableMissing(err)) return
    if (err instanceof MobileError && err.code === 'answered') return
    console.error('[mobile signup] settle on activation', err)
  }
}

// ── Status (the app's waiting screen and the sign-in errors) ────────────────

export async function driverSignupStatus(driverId: string): Promise<{ status: SignupStatus; name: string | null; note: string | null }> {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true, isActive: true } })
  if (!d) return { status: 'GONE', name: null, note: null }
  if (d.isActive) return { status: 'APPROVED', name: d.name, note: null }
  const r = await prisma.mobileDriverRequest.findFirst({
    where: { driverId, kind: SIGNUP }, orderBy: { createdAt: 'desc' }, select: { status: true, decisionNote: true },
  })
  if (r?.status === 'REJECTED') return { status: 'REJECTED', name: d.name, note: r.decisionNote }
  if (r?.status === 'APPROVED') {
    // Approved once, switched off later.
    return { status: 'REJECTED', name: d.name, note: 'Your driver profile is switched off. Please contact operations.' }
  }
  return { status: 'PENDING', name: d.name, note: null }
}

/** The error an inactive driver gets at sign-in — tells "waiting" apart from "switched off". */
export async function inactiveDriverError(driverId: string): Promise<MobileError> {
  try {
    const r = await prisma.mobileDriverRequest.findFirst({
      where: { driverId, kind: SIGNUP }, orderBy: { createdAt: 'desc' }, select: { status: true, decisionNote: true },
    })
    if (r?.status === 'PENDING') {
      return new MobileError('Your registration is waiting for approval from the operations team. We will let you know as soon as you are approved.', 403, 'pending_approval')
    }
    if (r?.status === 'REJECTED') {
      return new MobileError(`Your registration was not approved${r.decisionNote ? ` (${r.decisionNote})` : ''}. Please contact operations.`, 403, 'registration_declined')
    }
  } catch {
    // mobile tables missing — fall through to the plain message
  }
  return new MobileError('Your driver profile is not active. Please contact operations.', 403, 'inactive')
}

/** Lets the waiting screen receive the "approved" push before the person has a session. */
export async function savePendingPushToken(kind: 'DRIVER' | 'VENDOR', id: string, token: string, platform: string | null): Promise<void> {
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(token)) return
  await prisma.mobilePushToken.upsert({
    where: { token },
    create: { token, actorType: kind, actorId: id, platform: platform?.slice(0, 16) ?? null },
    update: { actorType: kind, actorId: id, platform: platform?.slice(0, 16) ?? null },
  }).catch(err => { if (!isMobileTableMissing(err)) console.error('[mobile signup] push token', err) })
}

// ── Vendors ─────────────────────────────────────────────────────────────────

export async function notifyStaffOfVendorSignup(vendorId: string, source: 'APP' | 'WEB'): Promise<void> {
  try {
    const v = await prisma.vehicleVendor.findUnique({ where: { id: vendorId }, select: { name: true, email: true, country: true } })
    if (!v) return
    await notifyStaff(v.country, {
      kind: 'VENDOR_SIGNUP',
      title: `New vehicle vendor · ${v.name}`,
      body: `${v.email ?? ''} registered from the ${source === 'APP' ? 'app' : 'vendor portal'} — approve it on Vehicle Vendors.`.trim(),
      data: { vendorId },
      dedupeKey: `vendor-signup:${vendorId}`,
    })
  } catch (err) {
    if (!isMobileTableMissing(err)) console.error('[mobile signup] vendor staff notify', err)
  }
}

/** Called when ops switch on a self-registered vendor (the Vendors page). */
export async function notifyVendorApproved(vendorId: string): Promise<void> {
  const v = await prisma.vehicleVendor.findUnique({ where: { id: vendorId }, select: { name: true, email: true } }).catch(() => null)
  if (!v) return
  await notify({
    actorType: 'VENDOR', actorId: vendorId, kind: 'SIGNUP_APPROVED',
    title: 'Your vendor account is active ✅',
    body: 'Sign in as Vehicle Vendor with your e-mail and password.',
    data: { vendorId },
    dedupeKey: `vendor-approved:${vendorId}:${new Date().toISOString().slice(0, 10)}`,
  }).catch(err => { if (!isMobileTableMissing(err)) console.error('[mobile signup] vendor notify', err) })
  await mailRegistrant(v.email, 'Your Aahaas vendor account is active', `Welcome, ${v.name}!`, [
    'Your vehicle vendor account has been approved by the operations team.',
    'Sign in to the Aahaas app (Vehicle Vendor) or the vendor portal with your e-mail and password, then add your drivers and vehicles.',
  ])
}
