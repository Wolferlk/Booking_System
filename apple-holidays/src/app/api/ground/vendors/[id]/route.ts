import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { name, phone, email, address, country, isActive } = body

  const vendor = await prisma.vehicleVendor.update({
    where: { id: params.id },
    data: {
      name:     name     || undefined,
      phone:    phone    ?? null,
      email:    email    ?? null,
      address:  address  ?? null,
      country:  country  ?? undefined,
      isActive: isActive ?? undefined,
    },
  })

  return buildApiSuccess(vendor, 'Vendor updated')
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN', 'GT_USER'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  // 1. Unlink drivers' vehicle assignments for vehicles owned by this vendor
  const vehicleIds = await prisma.vehicle.findMany({
    where: { vendorId: params.id },
    select: { id: true },
  })
  if (vehicleIds.length > 0) {
    await prisma.driver.updateMany({
      where: { vehicleId: { in: vehicleIds.map(v => v.id) } },
      data: { vehicleId: null },
    })
  }

  // 2. Unlink vendorId from drivers directly owned by this vendor
  await prisma.driver.updateMany({
    where: { vendorId: params.id },
    data: { vendorId: null },
  })

  // 3. Delete the vehicles belonging to this vendor
  await prisma.vehicle.deleteMany({ where: { vendorId: params.id } })

  // 4. Clear vendorId from assignments (don't delete — preserve trip history)
  await prisma.assignment.updateMany({
    where: { vendorId: params.id },
    data: { vendorId: null },
  })

  // 5. Delete the vendor
  await prisma.vehicleVendor.delete({ where: { id: params.id } })

  return buildApiSuccess(null, 'Vendor deleted')
}
