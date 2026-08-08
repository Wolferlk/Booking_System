import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { handlePrismaApiError } from '@/lib/prisma-error'

export const dynamic = 'force-dynamic'
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json()
  const { type, plateNo, brand, model, capacity, description, photoOutside, photoInside, isActive, vendorId, driverId } = body

  let vehicle
  try {
    if (driverId !== undefined) {
      const driver = driverId
        ? await prisma.driver.findFirst({
            where: {
              id: driverId,
              ...(vendorId ? { vendorId } : {}),
            },
          })
        : null

      if (driverId && !driver) {
        return buildApiError('Driver not found')
      }

      await prisma.driver.updateMany({
        where: { vehicleId: params.id },
        data: { vehicleId: null },
      })

      if (driverId) {
        await prisma.driver.updateMany({
          where: { id: driverId },
          data: { vehicleId: params.id },
        })
      }
    }

    vehicle = await prisma.vehicle.update({
      where: { id: params.id },
      data: {
        ...(type !== undefined && { type }),
        ...(plateNo !== undefined && { plateNo }),
        ...(brand !== undefined && { brand }),
        ...(model !== undefined && { model }),
        ...(capacity !== undefined && { capacity: Number(capacity) }),
        ...(description !== undefined && { description }),
        ...(photoOutside !== undefined && { photoOutside }),
        ...(photoInside !== undefined && { photoInside }),
        ...(isActive !== undefined && { isActive }),
        ...(vendorId !== undefined && { vendorId: vendorId || null }),
      },
      include: {
        driver: { select: { id: true, name: true, phone: true, photoUrl: true } },
        vendor: true,
      },
    })
  } catch (error) {
    return handlePrismaApiError(error, 'Failed to update vehicle', 'Vehicle plate number already exists')
  }

  return buildApiSuccess(vehicle, 'Vehicle updated')
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  await prisma.vehicle.delete({ where: { id: params.id } })
  return buildApiSuccess(null, 'Vehicle deleted')
}
