import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { setVendorCookie } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

// GET — fetch vendor info by ID for pre-filling the registration form
export async function GET(req: NextRequest) {
  const vendorId = req.nextUrl.searchParams.get('id')
  if (!vendorId) return buildApiError('Missing vendor ID')

  const vendor = await prisma.vehicleVendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, email: true, phone: true, country: true, isRegistered: true },
  })
  if (!vendor) return buildApiError('Invalid registration link', 404)

  return buildApiSuccess(vendor)
}

// POST — complete vendor registration
export async function POST(req: NextRequest) {
  const { vendorId, name, email, whatsappPhone, password } = await req.json()
  if (!vendorId || !name?.trim() || !password) return buildApiError('Name and password are required')
  if (password.length < 6) return buildApiError('Password must be at least 6 characters')

  const vendor = await prisma.vehicleVendor.findUnique({ where: { id: vendorId } })
  if (!vendor) return buildApiError('Invalid registration link', 404)
  if (vendor.isRegistered) return buildApiError('This vendor is already registered')

  const hashed = await bcrypt.hash(password, 10)

  const updated = await prisma.vehicleVendor.update({
    where: { id: vendorId },
    data: {
      name: name.trim(),
      email: email?.trim() || vendor.email,
      whatsappPhone: whatsappPhone?.trim() || null,
      password: hashed,
      isRegistered: true,
    },
  })

  setVendorCookie(updated.id)

  return buildApiSuccess({ id: updated.id, name: updated.name }, 'Registration complete')
}
