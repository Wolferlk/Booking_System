/**
 * POST /api/mobile/auth/login  { identifier, password, criticalPassword? }
 *
 * One sign-in box for both kinds of user:
 *   * an e-mail that belongs to an ops account (users) → STAFF, same password
 *     as ops.aahaas.com (Ultra Super Admin also needs the critical password,
 *     as on the web)
 *   * otherwise a driver's phone or e-mail → DRIVER, with the password they
 *     set in the app. A driver who has never set one gets code 'not_activated'
 *     and the app moves them to the "first time" flow.
 */
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { normalizeEmail } from '@/lib/credential-match'
import { COMPANY_ROLES, signDriverToken, signStaffToken } from '@/lib/mobile/auth'
import { MobileError, clientIp, mobileRoute, readJson } from '@/lib/mobile/http'
import { findDriverByIdentifier } from '@/lib/mobile/otp'
import { driverProfile, staffProfile } from '@/lib/mobile/profile'

export const dynamic = 'force-dynamic'

// Best-effort brute-force brake per IP (per server instance).
const failures = new Map<string, { n: number; until: number }>()
function guard(ip: string | null) {
  const f = ip ? failures.get(ip) : null
  if (f && f.until > Date.now()) throw new MobileError('Too many attempts. Please wait a minute.', 429, 'rate_limited')
}
function fail(ip: string | null, message: string, code = 'bad_credentials'): never {
  if (ip) {
    const f = failures.get(ip) ?? { n: 0, until: 0 }
    f.n += 1
    if (f.n >= 8) { f.until = Date.now() + 60_000; f.n = 0 }
    failures.set(ip, f)
  }
  throw new MobileError(message, 401, code)
}

export const POST = mobileRoute('login', async (req: NextRequest) => {
  const ip = clientIp(req)
  guard(ip)
  const body = await readJson<{ identifier?: string; password?: string; criticalPassword?: string; platform?: string; appVersion?: string; as?: 'DRIVER' | 'COMPANY' }>(req)
  const identifier = String(body.identifier ?? '').trim()
  const password = String(body.password ?? '')
  if (!identifier || !password) throw new MobileError('Enter your phone or e-mail and your password.')

  // ── Staff ────────────────────────────────────────────────────────────────
  if (identifier.includes('@') && body.as !== 'DRIVER') {
    const user = await prisma.user.findFirst({ where: { email: normalizeEmail(identifier) } })
      ?? await prisma.user.findUnique({ where: { email: identifier } })
    if (user) {
      if (!(await bcrypt.compare(password, user.password))) fail(ip, 'Wrong e-mail or password.')
      if (!user.isActive) throw new MobileError('This account is inactive.', 403, 'inactive')
      if (!COMPANY_ROLES.includes(user.role)) {
        throw new MobileError('This account cannot use the app. Please use ops.aahaas.com.', 403, 'role')
      }
      if (user.role === 'ULTRA_SUPER_ADMIN') {
        const expected = process.env.CRITICAL_SERVICES_PASSWORD
        if (!body.criticalPassword) throw new MobileError('Enter the critical services password.', 401, 'critical_required')
        if (!expected || body.criticalPassword !== expected) fail(ip, 'Critical services password is wrong.', 'critical_wrong')
      }
      return buildApiSuccess({ token: await signStaffToken(user.id), actor: await staffProfile(user.id) })
    }
  }

  // ── Driver ───────────────────────────────────────────────────────────────
  if (body.as === 'COMPANY') fail(ip, 'No company account with that e-mail. Drivers: use Driver sign in.', 'not_found')
  const driver = await findDriverByIdentifier(identifier)
  if (!driver) fail(ip, 'We could not find a driver with that phone or e-mail.', 'not_found')
  if (!driver.isActive) throw new MobileError('Your driver profile is not active. Please contact operations.', 403, 'inactive')
  const account = await prisma.mobileDriverAccount.findUnique({ where: { driverId: driver.id } })
  if (!account?.passwordHash) {
    throw new MobileError('First time here? Verify your phone to set a password.', 409, 'not_activated')
  }
  if (!(await bcrypt.compare(password, account.passwordHash))) fail(ip, 'Wrong password.')

  await prisma.mobileDriverAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date(), platform: body.platform?.slice(0, 16) ?? null, appVersion: body.appVersion?.slice(0, 32) ?? null },
  })
  return buildApiSuccess({
    token: await signDriverToken(driver.id, account.id, account.tokenVersion),
    actor: await driverProfile(driver.id),
  })
})
