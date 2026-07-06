import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getVendorSession()
    if (!session) return buildApiError('Unauthorized', 401)

    const vehicle = await prisma.vehicle.findFirst({ where: { id: params.id, vendorId: session.id } })
    if (!vehicle) return buildApiError('Not found', 404)

    const { type, brand, model, capacity, photoOutside, photoInside, isActive, driverId } = await req.json()

    if (driverId !== undefined) {
      await prisma.driver.updateMany({ where: { vehicleId: params.id }, data: { vehicleId: null } })
      if (driverId) {
        await prisma.driver.updateMany({
          where: { id: driverId, vendorId: session.id },
          data: { vehicleId: params.id },
        })
      }
    }

    const updated = await prisma.vehicle.update({
      where: { id: params.id },
      data: {
        type: type || undefined,
        brand: brand?.trim() || null,
        model: model?.trim() || null,
        capacity: capacity ? parseInt(capacity, 10) : undefined,
        photoOutside: photoOutside || null,
        photoInside: photoInside || null,
        isActive: isActive ?? undefined,
      },
      include: { driver: { select: { id: true, name: true, phone: true, photoUrl: true } } },
    })

    return buildApiSuccess(updated, 'Vehicle updated')
  } catch (err) {
    console.error('[vendor/vehicles/:id PUT]', err)
    return buildApiError(err instanceof Error ? err.message : 'Server error', 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getVendorSession()
    if (!session) return buildApiError('Unauthorized', 401)

    const vehicle = await prisma.vehicle.findFirst({ where: { id: params.id, vendorId: session.id } })
    if (!vehicle) return buildApiError('Not found', 404)

    await prisma.vehicle.delete({ where: { id: params.id } })
    return buildApiSuccess(null, 'Vehicle removed')
  } catch (err) {
    console.error('[vendor/vehicles/:id DELETE]', err)
    return buildApiError(err instanceof Error ? err.message : 'Server error', 500)
  }
}
