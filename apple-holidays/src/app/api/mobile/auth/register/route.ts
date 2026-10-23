/**
 * POST /api/mobile/auth/register
 *   { as: 'DRIVER', name, phone, email?, country, licenseNo?, password, vehicle?: { type, plateNo, brand?, model?, capacity } }
 *   { as: 'VENDOR', name, email, whatsappPhone?, country, password }
 *
 * New independent drivers and new vehicle vendors register from the app. Both
 * are saved switched off and wait for the operations team (drivers on
 * /dashboard/ground/drivers, vendors on /dashboard/ground/vendors). The reply
 * carries a `pendingToken` the waiting screen uses to ask for its status — it
 * is not a session (see lib/mobile/signup.ts).
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { signPendingToken } from '@/lib/mobile/auth'
import { MobileError, clientIp, mobileRoute, readJson } from '@/lib/mobile/http'
import { notifyStaffOfVendorSignup, registerDriver, type DriverSignupInput } from '@/lib/mobile/signup'
import { VENDOR_COUNTRIES, VendorRegisterError, registerVendor } from '@/lib/vendor-register'

export const dynamic = 'force-dynamic'

// Best-effort brake per IP (per server instance), on top of the server-wide hourly cap.
// Only finished registrations count — mobile networks put many phones behind one IP,
// and a typo that gets refused must not use up anyone's turn.
const PER_IP_PER_HOUR = 10
const recent = new Map<string, number[]>()
function hitsFor(ip: string): number[] {
  return (recent.get(ip) ?? []).filter(t => Date.now() - t < 3_600_000)
}
function guard(ip: string | null) {
  if (ip && hitsFor(ip).length >= PER_IP_PER_HOUR) {
    throw new MobileError('Too many registrations from this connection. Please try again later.', 429, 'rate_limited')
  }
}
function remember(ip: string | null) {
  if (ip) recent.set(ip, [...hitsFor(ip), Date.now()])
}

export const POST = mobileRoute('register', async (req: NextRequest) => {
  const body = await readJson<DriverSignupInput & { as?: string; whatsappPhone?: string }>(req)

  if (body.as === 'VENDOR') {
    // The portal form lets this be empty; in the app it has to be a real choice.
    if (!VENDOR_COUNTRIES.includes(body.country as never)) throw new MobileError('Choose your operation country.')
    const ip = clientIp(req)
    guard(ip)
    const lastHour = await prisma.vehicleVendor.count({ where: { isActive: false, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })
    if (lastHour >= 30) throw new MobileError('Too many registrations right now. Please try again in an hour.', 429, 'rate_limited')
    try {
      const vendor = await registerVendor(body)
      remember(ip)
      console.log(`[mobile signup] vendor ${vendor.name} (${vendor.id}) registered from the app — waiting for approval`)
      await notifyStaffOfVendorSignup(vendor.id, 'APP')
      return buildApiSuccess({
        kind: 'VENDOR', name: vendor.name, identifier: vendor.email,
        pendingToken: await signPendingToken('VENDOR', vendor.id),
      }, 'Registration submitted')
    } catch (err) {
      if (err instanceof VendorRegisterError) throw new MobileError(err.message, err.status, err.code)
      throw err
    }
  }

  if (body.as !== 'DRIVER') throw new MobileError('Choose driver or vendor.')
  const ip = clientIp(req)
  guard(ip)
  const driver = await registerDriver(body)
  remember(ip)
  return buildApiSuccess({
    kind: 'DRIVER', name: driver.name, identifier: driver.phone,
    pendingToken: await signPendingToken('DRIVER', driver.driverId),
  }, 'Registration submitted')
})
