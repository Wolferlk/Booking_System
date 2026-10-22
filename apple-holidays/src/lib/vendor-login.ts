/**
 * Vehicle-vendor sign-in, shared by the vendor portal (/api/vendor/auth/login,
 * cookie session) and the Aahaas app (/api/mobile/auth/login, bearer token) so
 * both accept exactly the same e-mail / phone + password.
 */
import bcrypt from 'bcryptjs'
import type { OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { looksLikePhone, normalizeEmail, phoneMatches } from '@/lib/credential-match'

const select = {
  id: true, name: true, email: true, phone: true, whatsappPhone: true,
  country: true, isActive: true, isRegistered: true, password: true,
} as const

export type VendorLoginRow = {
  id: string; name: string; email: string | null; phone: string | null
  whatsappPhone: string | null; country: OperationCountry | null
  isActive: boolean; isRegistered: boolean; password: string | null
}

export class VendorLoginError extends Error {
  constructor(message: string, public status = 401, public code = 'bad_credentials') { super(message) }
}

// A phone number or address can sit on more than one vendor row, so we test the password
// against every match rather than the first one — but cap the bcrypt work.
const MAX_CANDIDATES = 5

export async function authenticateVendor(input: { vendorId?: string | null; credential?: string | null; password: string }): Promise<VendorLoginRow> {
  const { vendorId, credential, password } = input
  if (!password) throw new VendorLoginError('Password is required', 400, 'missing')
  if (!vendorId && !credential) throw new VendorLoginError('Email, phone, or company selection is required', 400, 'missing')

  let candidates: VendorLoginRow[] = []

  if (vendorId) {
    // Login via selected company name (step 2 of company-search flow)
    candidates = await prisma.vehicleVendor.findMany({ where: { id: vendorId }, select })
  } else {
    const raw = String(credential).trim()

    // Only rows that can actually authenticate are worth looking at.
    const rows = await prisma.vehicleVendor.findMany({
      where: { password: { not: null } },
      select: { id: true, email: true, phone: true, whatsappPhone: true },
    })

    const ids = rows
      .filter(v => looksLikePhone(raw)
        ? phoneMatches(v.phone, raw) || phoneMatches(v.whatsappPhone, raw)
        : normalizeEmail(v.email) === normalizeEmail(raw))
      .map(v => v.id)
      .slice(0, MAX_CANDIDATES)

    if (ids.length) {
      candidates = await prisma.vehicleVendor.findMany({ where: { id: { in: ids } }, select })
    }
  }

  if (!candidates.length) {
    throw new VendorLoginError('No vendor account found for that email or phone number. Please check it, or register first.', 401, 'not_found')
  }

  let vendor: VendorLoginRow | null = null
  for (const c of candidates) {
    if (c.password && await bcrypt.compare(password, c.password)) { vendor = c; break }
  }
  if (!vendor) throw new VendorLoginError('Incorrect password. Please try again.')

  // Mirrors getVendorSession(), so a vendor can never log in only to be bounced straight back.
  if (!vendor.isRegistered) {
    throw new VendorLoginError('This account is not set up for the vendor portal yet. Please contact the team.', 403, 'not_registered')
  }
  if (!vendor.isActive) {
    throw new VendorLoginError('Your account is pending admin approval. Please contact the team.', 403, 'inactive')
  }
  return vendor
}
