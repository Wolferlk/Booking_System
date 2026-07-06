import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from './prisma'

const SECRET  = process.env.NEXTAUTH_SECRET ?? 'vendor-fallback-secret'
const COOKIE  = 'vendor_session'
const MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days

export function createVendorToken(vendorId: string): string {
  const ts   = Date.now().toString()
  const data = `${vendorId}:${ts}`
  const sig  = createHmac('sha256', SECRET).update(data).digest('hex')
  return Buffer.from(`${data}:${sig}`).toString('base64url')
}

export function parseVendorToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString()
    const lastColon = decoded.lastIndexOf(':')
    const data = decoded.slice(0, lastColon)
    const sig  = decoded.slice(lastColon + 1)
    const expected = createHmac('sha256', SECRET).update(data).digest('hex')
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    const [vendorId, ts] = data.split(':')
    if (Date.now() - parseInt(ts) > MAX_AGE) return null
    return vendorId
  } catch {
    return null
  }
}

export function setVendorCookie(vendorId: string) {
  const token = createVendorToken(vendorId)
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE / 1000,
    path: '/',
  })
}

export function clearVendorCookie() {
  cookies().set(COOKIE, '', { maxAge: 0, path: '/' })
}

export async function getVendorSession() {
  const token = cookies().get(COOKIE)?.value
  if (!token) return null
  const vendorId = parseVendorToken(token)
  if (!vendorId) return null
  const vendor = await prisma.vehicleVendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true, name: true, email: true, phone: true,
      whatsappPhone: true, address: true, country: true,
      isRegistered: true, isActive: true,
    },
  })
  if (!vendor || !vendor.isRegistered || !vendor.isActive) return null
  const { isRegistered: _, isActive: __, ...rest } = vendor
  return rest
}
