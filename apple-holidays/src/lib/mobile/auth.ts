/**
 * Aahaas Driver App — authentication for `/api/mobile/*`.
 *
 * The app cannot use the NextAuth cookie session, so it carries a bearer JWT
 * signed with its own secret. Two kinds of actor sign in through the same app:
 *
 *   DRIVER  a row in `drivers` (registered through /register/driver) with an
 *           app account in `mobile_driver_accounts`. Tokens carry the account's
 *           `tokenVersion`; a password reset bumps it, which signs every other
 *           phone out.
 *   STAFF   a row in `users` — the same e-mail + password as ops.aahaas.com.
 *           Only the desks that run drivers on the road get the app.
 *   VENDOR  a row in `vehicle_vendors` — the same login as the vendor portal
 *           (/vendor/login). Tokens carry a fingerprint of the vendor's
 *           password hash, so changing the portal password signs every phone
 *           out without needing a table of its own.
 *
 * `/api/mobile` is excluded from the NextAuth middleware (see src/middleware.ts)
 * exactly like `/api/vendor`, so every route here must call `requireDriver` /
 * `requireStaff` / `requireActor` itself.
 */
import { createHash } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { NextRequest } from 'next/server'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const SECRET = new TextEncoder().encode(
  process.env.MOBILE_JWT_SECRET || `${process.env.NEXTAUTH_SECRET || 'apple-holidays'}:mobile-app`,
)

const DRIVER_TTL = '60d'
const STAFF_TTL = '7d'
const VENDOR_TTL = '30d'

/** Staff roles that run drivers — the driver-ops views (live map, driver requests). */
export const MOBILE_STAFF_ROLES: UserRole[] = [
  'TE_USER', 'GT_USER', 'GT_TE_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

/**
 * Every ops.aahaas.com staff role may use the app's company login. What each
 * can do inside is decided by the same per-route checks as on the web (the
 * bridge in lib/mobile/bridge.ts runs the web routes as that user).
 */
export const COMPANY_ROLES: UserRole[] = [
  'BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'RS_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

export interface DriverActor {
  kind: 'DRIVER'
  driverId: string
  accountId: string
  name: string
  country: string | null
}

export interface StaffActor {
  kind: 'STAFF'
  userId: string
  name: string
  role: UserRole
  country: string
}

export interface VendorActor {
  kind: 'VENDOR'
  vendorId: string
  name: string
  country: string | null
}

export type MobileActor = DriverActor | StaffActor | VendorActor

/** The id an actor's push tokens and notifications are filed under. */
export function actorIdOf(actor: MobileActor): string {
  return actor.kind === 'DRIVER' ? actor.driverId : actor.kind === 'STAFF' ? actor.userId : actor.vendorId
}

export class MobileAuthError extends Error {
  constructor(message: string, public status = 401) { super(message) }
}

export async function signDriverToken(driverId: string, accountId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({ k: 'D', a: accountId, v: tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(driverId)
    .setIssuedAt()
    .setExpirationTime(DRIVER_TTL)
    .sign(SECRET)
}

export async function signStaffToken(userId: string): Promise<string> {
  return new SignJWT({ k: 'S' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(STAFF_TTL)
    .sign(SECRET)
}

function passwordFingerprint(hash: string | null): string {
  return createHash('sha256').update(hash ?? '').digest('hex').slice(0, 16)
}

export async function signVendorToken(vendorId: string, passwordHash: string | null): Promise<string> {
  return new SignJWT({ k: 'V', p: passwordFingerprint(passwordHash) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(vendorId)
    .setIssuedAt()
    .setExpirationTime(VENDOR_TTL)
    .sign(SECRET)
}

/** Short-lived token proving an OTP was verified — used to set a new password. */
export async function signResetToken(driverId: string, otpId: string): Promise<string> {
  return new SignJWT({ k: 'R', o: otpId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(driverId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(SECRET)
}

export async function verifyResetToken(token: string): Promise<{ driverId: string; otpId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    if (payload.k !== 'R' || !payload.sub) return null
    return { driverId: payload.sub, otpId: String(payload.o ?? '') }
  } catch {
    return null
  }
}

/**
 * Proof that this phone sent a registration (driver or vendor) — lets the
 * "waiting for approval" screen ask for its status. It never signs anyone in:
 * once ops approves, the person signs in with the password they chose.
 */
export async function signPendingToken(kind: 'DRIVER' | 'VENDOR', id: string): Promise<string> {
  return new SignJWT({ k: 'P', t: kind === 'DRIVER' ? 'D' : 'V' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime('180d')
    .sign(SECRET)
}

export async function verifyPendingToken(token: string): Promise<{ kind: 'DRIVER' | 'VENDOR'; id: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    if (payload.k !== 'P' || !payload.sub || (payload.t !== 'D' && payload.t !== 'V')) return null
    return { kind: payload.t === 'D' ? 'DRIVER' : 'VENDOR', id: payload.sub }
  } catch {
    return null
  }
}

function bearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1].trim() : null
}

export async function requireActor(req: NextRequest): Promise<MobileActor> {
  const token = bearer(req)
  if (!token) throw new MobileAuthError('Please sign in.')
  let payload: Record<string, unknown> & { sub?: string }
  try {
    payload = (await jwtVerify(token, SECRET)).payload as typeof payload
  } catch {
    throw new MobileAuthError('Your session has expired. Please sign in again.')
  }
  if (!payload.sub) throw new MobileAuthError('Please sign in.')

  if (payload.k === 'D') {
    const [account, driver] = await Promise.all([
      prisma.mobileDriverAccount.findUnique({ where: { driverId: payload.sub } }),
      prisma.driver.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, isActive: true, country: true } }),
    ])
    if (!account || !driver || account.id !== payload.a) throw new MobileAuthError('Please sign in again.')
    if (account.tokenVersion !== Number(payload.v ?? -1)) throw new MobileAuthError('You were signed out. Please sign in again.')
    if (!driver.isActive) throw new MobileAuthError('Your profile is not active. Please contact operations.', 403)
    // Cheap presence signal for the ops view; never blocks the request.
    if (!account.lastSeenAt || Date.now() - account.lastSeenAt.getTime() > 5 * 60_000) {
      prisma.mobileDriverAccount.update({ where: { id: account.id }, data: { lastSeenAt: new Date() } }).catch(() => {})
    }
    return { kind: 'DRIVER', driverId: driver.id, accountId: account.id, name: driver.name, country: driver.country ?? null }
  }

  if (payload.k === 'S') {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, role: true, country: true, isActive: true },
    })
    if (!user || !user.isActive) throw new MobileAuthError('Please sign in again.')
    if (!COMPANY_ROLES.includes(user.role)) throw new MobileAuthError('This account cannot use the app.', 403)
    return { kind: 'STAFF', userId: user.id, name: user.name, role: user.role, country: user.country }
  }

  if (payload.k === 'V') {
    const vendor = await prisma.vehicleVendor.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, country: true, isActive: true, isRegistered: true, password: true },
    })
    if (!vendor || !vendor.isRegistered) throw new MobileAuthError('Please sign in again.')
    if (passwordFingerprint(vendor.password) !== payload.p) throw new MobileAuthError('Your password was changed. Please sign in again.')
    if (!vendor.isActive) throw new MobileAuthError('Your vendor account is not active. Please contact operations.', 403)
    return { kind: 'VENDOR', vendorId: vendor.id, name: vendor.name, country: vendor.country ?? null }
  }

  throw new MobileAuthError('Please sign in.')
}

/** Vehicle vendors (fleet owners) — their own drivers, vehicles and trips only. */
export async function requireVendor(req: NextRequest): Promise<VendorActor> {
  const a = await requireActor(req)
  if (a.kind !== 'VENDOR') throw new MobileAuthError('This screen is for vehicle vendors.', 403)
  return a
}

export async function requireDriver(req: NextRequest): Promise<DriverActor> {
  const a = await requireActor(req)
  if (a.kind !== 'DRIVER') throw new MobileAuthError('This screen is for drivers.', 403)
  return a
}

export async function requireStaff(req: NextRequest): Promise<StaffActor> {
  const a = await requireActor(req)
  if (a.kind !== 'STAFF') throw new MobileAuthError('This screen is for the operations team.', 403)
  return a
}

/** Staff who run drivers (live map, driver requests, vehicle checks). */
export async function requireDriverOps(req: NextRequest): Promise<StaffActor> {
  const a = await requireStaff(req)
  if (!MOBILE_STAFF_ROLES.includes(a.role)) throw new MobileAuthError('Driver operations are not part of your role.', 403)
  return a
}

/** Country filter for staff reads — same rule as the web (ALL sees all). */
export function staffSeesCountry(actor: StaffActor, country: string | null | undefined): boolean {
  if (actor.role === 'ULTRA_SUPER_ADMIN' || actor.country === 'ALL') return true
  return !country || country === actor.country
}
