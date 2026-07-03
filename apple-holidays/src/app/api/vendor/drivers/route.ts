import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const drivers = await prisma.driver.findMany({
    where: { vehicle: { vendorId: session.id } },
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

  const {
    name, phone, email, licenseNo, photoUrl, country,
    vehicleType, vehiclePlateNo, vehicleBrand, vehicleModel, vehicleCapacity,
    vehiclePhotoOutside, vehiclePhotoInside,
    bankName, bankAccountNo, bankHolder, bankBranch, bankCode,
  } = await req.json()

  if (!name?.trim()) return buildApiError('Driver name is required')
  if (!phone?.trim()) return buildApiError('Phone number is required')

  let vehicleId: string | null = null

  if (vehiclePlateNo?.trim()) {
    try {
      const vehicle = await prisma.vehicle.create({
        data: {
          type: vehicleType || 'car',
          plateNo: vehiclePlateNo.trim().toUpperCase(),
          brand: vehicleBrand?.trim() || null,
          model: vehicleModel?.trim() || null,
          capacity: vehicleCapacity ? parseInt(vehicleCapacity, 10) : 4,
          photoOutside: vehiclePhotoOutside || null,
          photoInside: vehiclePhotoInside || null,
          vendorId: session.id,
        },
      })
      vehicleId = vehicle.id
    } catch {
      return buildApiError('A vehicle with that plate number already exists')
    }
  }

  const driver = await prisma.driver.create({
    data: {
      name: name.trim(),
      phone: phone.trim(),
      email: email?.trim() || null,
      licenseNo: licenseNo?.trim() || null,
      photoUrl: photoUrl || null,
      isActive: true,
      country: (country || session.country) ?? null,
      vehicleId,
      bankName: bankName?.trim() || null,
      bankAccountNo: bankAccountNo?.trim() || null,
      bankHolder: bankHolder?.trim() || null,
      bankBranch: bankBranch?.trim() || null,
      bankCode: bankCode?.trim() || null,
    },
    include: { vehicle: true },
  })

  return buildApiSuccess(driver, 'Driver added')
}
