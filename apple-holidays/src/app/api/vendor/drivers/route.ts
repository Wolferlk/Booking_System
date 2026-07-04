import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const drivers = await prisma.driver.findMany({
    where: { vendorId: session.id },
    include: {
      vehicle: { select: { id: true, plateNo: true, type: true, brand: true, model: true, capacity: true, photoOutside: true, photoInside: true } },
    },
    orderBy: { name: 'asc' },
  })

  return buildApiSuccess(drivers)
}

export async function POST(req: NextRequest) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const { name, phone, email, licenseNo, photoUrl, vehicleId } = await req.json()

  if (!name?.trim()) return buildApiError('Driver name is required')
  if (!phone?.trim()) return buildApiError('Phone number is required')

  // If assigning a vehicle, verify it belongs to this vendor and unlink any existing driver
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, vendorId: session.id } })
    if (!vehicle) return buildApiError('Vehicle not found in your fleet')
    await prisma.driver.updateMany({ where: { vehicleId }, data: { vehicleId: null } })
  }

  const driver = await prisma.driver.create({
    data: {
      name: name.trim(),
      phone: phone.trim(),
      email: email?.trim() || null,
      licenseNo: licenseNo?.trim() || null,
      photoUrl: photoUrl || null,
      isActive: true,
      country: session.country ?? null,
      vendorId: session.id,
      vehicleId: vehicleId || null,
    },
    include: { vehicle: true },
  })

  return buildApiSuccess(driver, 'Driver added')
}
