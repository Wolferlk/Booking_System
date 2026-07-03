import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { setVendorCookie } from '@/lib/vendor-auth'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

// POST — vendor self-registration (creates a new vendor, pending admin approval)
export async function POST(req: NextRequest) {
  const { name, email, whatsappPhone, password, country } = await req.json()

  if (!name?.trim()) return buildApiError('Company name is required')
  if (!email?.trim()) return buildApiError('Email is required')
  if (!password || password.length < 6) return buildApiError('Password must be at least 6 characters')

  // Prevent duplicate email registrations
  const existing = await prisma.vehicleVendor.findFirst({
    where: { email: email.trim().toLowerCase() },
  })
  if (existing) return buildApiError('An account with this email already exists. Please contact admin if you need help.')

  const hashed = await bcrypt.hash(password, 10)

  const vendor = await prisma.vehicleVendor.create({
    data: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      whatsappPhone: whatsappPhone?.trim() || null,
      password: hashed,
      isRegistered: true,
      isActive: false, // pending admin approval
      country: (country as OperationCountry) || null,
    },
  })

  return buildApiSuccess(
    { id: vendor.id, name: vendor.name, pending: true },
    'Registration submitted! Please wait for admin approval before logging in.'
  )
}

// GET — check if an email is already registered (for form validation)
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  if (!email) return buildApiSuccess({ exists: false })
  const existing = await prisma.vehicleVendor.findFirst({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  })
  return buildApiSuccess({ exists: !!existing })
}
