import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { handlePrismaApiError } from '@/lib/prisma-error'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const vendor = await prisma.vehicleVendor.findUnique({
    where: { id: params.id },
    include: {
      drivers:  { include: { vehicle: true } },
      vehicles: true,
    },
  })

  if (!vendor) return buildApiError('Vendor not found', 404)
  return buildApiSuccess(vendor)
}

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

  try {
    await prisma.$transaction(async tx => {
      const vehicleIds = await tx.vehicle.findMany({
        where: { vendorId: params.id },
        select: { id: true },
      })

      if (vehicleIds.length > 0) {
        await tx.driver.updateMany({
          where: { vehicleId: { in: vehicleIds.map(v => v.id) } },
          data: { vehicleId: null },
        })
      }

      await tx.driver.updateMany({
        where: { vendorId: params.id },
        data: { vendorId: null },
      })

      await tx.assignment.updateMany({
        where: { vendorId: params.id },
        data: { vendorId: null },
      })

      await tx.vehicle.deleteMany({ where: { vendorId: params.id } })
      await tx.vehicleVendor.delete({ where: { id: params.id } })
    })

    return buildApiSuccess(null, 'Vendor deleted')
  } catch (error) {
    return handlePrismaApiError(error, 'Failed to delete vendor', 'Vendor could not be deleted')
  }
}
