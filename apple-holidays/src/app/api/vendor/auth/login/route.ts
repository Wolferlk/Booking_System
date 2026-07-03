import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { setVendorCookie } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { vendorId, password } = await req.json()
  if (!vendorId || !password) return buildApiError('Vendor and password required')

  const vendor = await prisma.vehicleVendor.findUnique({
    where: { id: vendorId, isRegistered: true, isActive: true },
  })
  if (!vendor || !vendor.password) return buildApiError('Invalid credentials', 401)

  const valid = await bcrypt.compare(password, vendor.password)
  if (!valid) return buildApiError('Invalid credentials', 401)

  setVendorCookie(vendor.id)

  return buildApiSuccess({
    id: vendor.id,
    name: vendor.name,
    email: vendor.email,
    country: vendor.country,
  }, 'Logged in')
}
