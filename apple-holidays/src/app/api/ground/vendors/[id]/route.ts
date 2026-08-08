import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { handlePrismaApiError } from '@/lib/prisma-error'
import type { OperationCountry, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

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

  // A partial body has to stay partial. The Active toggle sends `{ isActive }` and nothing
  // else, and `email ?? null` turned that into "wipe the email, phone and address" — so
  // approving a vendor's registration deleted the very address they sign in with, and the
  // portal then told them no account existed. The edit modal always sends every field, so
  // clearing one on purpose still works: it arrives as "" and is stored as null.
  const data: Prisma.VehicleVendorUpdateInput = {}
  const setText = (value: unknown) => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    return trimmed || null
  }

  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
  if (body.phone !== undefined) data.phone = setText(body.phone)
  if (body.email !== undefined) data.email = setText(body.email)?.toLowerCase() ?? null
  if (body.address !== undefined) data.address = setText(body.address)
  if (body.country !== undefined) data.country = (body.country || null) as OperationCountry | null
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  const vendor = await prisma.vehicleVendor.update({
    where: { id: params.id },
    data,
  })

  return buildApiSuccess(vendor, 'Vendor updated')
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN', 'GT_USER', 'GT_VN_USER'].includes(session.user.role)) return buildApiError('Forbidden', 403)

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
