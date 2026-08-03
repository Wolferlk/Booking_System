import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { setVendorCookie } from '@/lib/vendor-auth'
import { looksLikePhone, normalizeEmail, phoneMatches } from '@/lib/credential-match'

export const dynamic = 'force-dynamic'

// Prisma select that explicitly includes the vendor-portal fields
const select = {
  id: true, name: true, email: true, phone: true, whatsappPhone: true,
  country: true, isActive: true, isRegistered: true, password: true,
} as const

type VendorRow = {
  id: string; name: string; email: string | null; phone: string | null
  whatsappPhone: string | null; country: import('@prisma/client').OperationCountry | null
  isActive: boolean; isRegistered: boolean; password: string | null
}

// A phone number or address can sit on more than one vendor row, so we test the password
// against every match rather than the first one — but cap the bcrypt work.
const MAX_CANDIDATES = 5

export async function POST(req: NextRequest) {
  try {
    const { vendorId, credential, password } = await req.json()
    if (!password) return buildApiError('Password is required')
    if (!vendorId && !credential) return buildApiError('Email, phone, or company selection is required')

    let candidates: VendorRow[] = []

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
      return buildApiError('No vendor account found for that email or phone number. Please check it, or register first.', 401)
    }

    let vendor: VendorRow | null = null
    for (const c of candidates) {
      if (c.password && await bcrypt.compare(password, c.password)) { vendor = c; break }
    }
    if (!vendor) return buildApiError('Incorrect password. Please try again.', 401)

    // Mirrors getVendorSession(), so a vendor can never log in only to be bounced straight back.
    if (!vendor.isRegistered) {
      return buildApiError('This account is not set up for the vendor portal yet. Please contact the team.', 403)
    }
    if (!vendor.isActive) {
      return buildApiError('Your account is pending admin approval. Please contact the team.', 403)
    }

    setVendorCookie(vendor.id)

    return buildApiSuccess({
      id: vendor.id,
      name: vendor.name,
      email: vendor.email,
      country: vendor.country,
    }, 'Logged in')
  } catch (err) {
    console.error('[vendor-login]', err)
    return buildApiError('Login failed. Please try again.', 500)
  }
}
