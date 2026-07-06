import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const vehicles = await prisma.vehicle.findMany({
    where: { vendorId: session.id },
    include: { driver: { select: { id: true, name: true, phone: true, photoUrl: true } } },
    orderBy: { plateNo: 'asc' },
  })

  return buildApiSuccess(vehicles)
}

export async function POST(req: NextRequest) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const { type, plateNo, brand, model, capacity, photoOutside, photoInside, driverId } = await req.json()
  if (!plateNo?.trim()) return buildApiError('Plate number is required')

  // Validate driver belongs to this vendor
  if (driverId) {
    const driver = await prisma.driver.findFirst({ where: { id: driverId, vendorId: session.id } })
    if (!driver) return buildApiError('Driver not found in your fleet')
  }

  try {
    const vehicle = await prisma.vehicle.create({
      data: {
        type: type || 'car',
        plateNo: plateNo.trim().toUpperCase(),
        brand: brand?.trim() || null,
        model: model?.trim() || null,
        capacity: capacity ? parseInt(capacity, 10) : 4,
        photoOutside: photoOutside || null,
        photoInside: photoInside || null,
        vendorId: session.id,
      },
      include: { driver: true },
    })

    // Assign driver to the newly created vehicle
    if (driverId) {
      // Unlink this driver from any previous vehicle first
      await prisma.driver.updateMany({ where: { id: driverId }, data: { vehicleId: vehicle.id } })
    }

    return buildApiSuccess(vehicle, 'Vehicle added')
  } catch {
    return buildApiError('A vehicle with that plate number already exists')
  }
}
