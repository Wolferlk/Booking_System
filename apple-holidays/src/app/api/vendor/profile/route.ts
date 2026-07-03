import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const vendor = await prisma.vehicleVendor.findUnique({
    where: { id: session.id },
    select: {
      id: true, name: true, email: true, phone: true,
      whatsappPhone: true, address: true, country: true, isRegistered: true,
    },
  })
  return buildApiSuccess(vendor)
}

export async function PUT(req: NextRequest) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const { name, email, phone, whatsappPhone, address, currentPassword, newPassword } = await req.json()
  if (!name?.trim()) return buildApiError('Name is required')

  const updates: Record<string, unknown> = {
    name: name.trim(),
    email: email?.trim() || null,
    phone: phone?.trim() || null,
    whatsappPhone: whatsappPhone?.trim() || null,
    address: address?.trim() || null,
  }

  if (newPassword) {
    if (newPassword.length < 6) return buildApiError('New password must be at least 6 characters')
    const vendor = await prisma.vehicleVendor.findUnique({ where: { id: session.id } })
    if (!vendor?.password) return buildApiError('Cannot verify current password')
    const valid = await bcrypt.compare(currentPassword ?? '', vendor.password)
    if (!valid) return buildApiError('Current password is incorrect')
    updates.password = await bcrypt.hash(newPassword, 10)
  }

  const updated = await prisma.vehicleVendor.update({
    where: { id: session.id },
    data: updates,
  })

  return buildApiSuccess(updated, 'Profile updated')
}
