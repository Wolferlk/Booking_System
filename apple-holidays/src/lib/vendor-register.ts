/**
 * Vehicle-vendor self-registration, shared by the vendor portal
 * (/api/public/vendor-register) and the Aahaas app (/api/mobile/auth/register)
 * so both create exactly the same row: `isRegistered` with `isActive` off,
 * which the Vendors page (/dashboard/ground/vendors) shows as "Pending
 * Approval" until ops switches it on.
 */
import bcrypt from 'bcryptjs'
import type { OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeEmail, phoneMatches } from '@/lib/credential-match'

export const VENDOR_COUNTRIES: OperationCountry[] = ['SRILANKA', 'VIETNAM', 'SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA']

export class VendorRegisterError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid') { super(message) }
}

export interface VendorRegisterInput {
  name?: unknown
  email?: unknown
  whatsappPhone?: unknown
  password?: unknown
  country?: unknown
}

export async function registerVendor(input: VendorRegisterInput): Promise<{ id: string; name: string; email: string }> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!name) throw new VendorRegisterError('Company name is required')
  if (!email.trim()) throw new VendorRegisterError('Email is required')
  if (password.length < 6) throw new VendorRegisterError('Password must be at least 6 characters')

  const cleanEmail = normalizeEmail(email)
  const cleanWhatsapp = (typeof input.whatsappPhone === 'string' ? input.whatsappPhone.trim() : '') || null
  // An unknown value used to reach Prisma and fail the whole registration with a 500.
  const country = VENDOR_COUNTRIES.includes(input.country as OperationCountry) ? (input.country as OperationCountry) : null

  // The duplicate check has to see the same way the login does. A plain equality lookup
  // only caught rows stored in exactly the same shape, so a second account for the same
  // person slipped through — and then the portal had two rows to authenticate against and
  // signed them into whichever one it hit first.
  const rows = await prisma.vehicleVendor.findMany({
    select: { id: true, email: true, phone: true, whatsappPhone: true },
  })
  const clash = rows.find(v =>
    normalizeEmail(v.email) === cleanEmail ||
    (cleanWhatsapp ? phoneMatches(v.phone, cleanWhatsapp) || phoneMatches(v.whatsappPhone, cleanWhatsapp) : false)
  )
  if (clash) {
    throw new VendorRegisterError(
      'An account already exists with this email or WhatsApp number. Sign in instead, or contact the team if you cannot get in.',
      409, 'exists',
    )
  }

  const hashed = await bcrypt.hash(password, 10)

  const vendor = await prisma.vehicleVendor.create({
    data: {
      name: name.slice(0, 190),
      email: cleanEmail,
      whatsappPhone: cleanWhatsapp,
      password: hashed,
      isRegistered: true,
      isActive: false,
      country,
    },
    select: { id: true, name: true },
  })
  return { id: vendor.id, name: vendor.name, email: cleanEmail }
}

export type SignupStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'GONE'

/**
 * Where a self-registered vendor stands. Ops approve by switching the vendor on;
 * a registration ops deleted (or turned back into a portal-less vendor) is GONE.
 */
export async function vendorSignupStatus(vendorId: string): Promise<{ status: SignupStatus; name: string | null; email: string | null }> {
  const v = await prisma.vehicleVendor.findUnique({
    where: { id: vendorId },
    select: { name: true, email: true, isActive: true, isRegistered: true },
  })
  if (!v || !v.isRegistered) return { status: 'GONE', name: v?.name ?? null, email: v?.email ?? null }
  return { status: v.isActive ? 'APPROVED' : 'PENDING', name: v.name, email: v.email }
}
