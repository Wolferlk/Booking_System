import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { handlePrismaApiError } from '@/lib/prisma-error'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_COUNTRIES: OperationCountry[] = [
  'VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA',
]

export async function POST(req: NextRequest) {
  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid request body')
  }

  const {
    name, phone, email, licenseNo, photoUrl, country,
    vehicleType, vehiclePlateNo, vehicleBrand, vehicleModel, vehicleCapacity,
    vehiclePhotoOutside, vehiclePhotoInside,
    bankName, bankAccountNo, bankHolder, bankBranch, bankCode,
  } = body

  if (!name?.trim()) return buildApiError('Full name is required')
  if (!phone?.trim()) return buildApiError('Phone number is required')

  const driverCountry = VALID_COUNTRIES.includes(country as OperationCountry)
    ? (country as OperationCountry)
    : null

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
          photoOutside: vehiclePhotoOutside?.trim() || null,
          photoInside: vehiclePhotoInside?.trim() || null,
        },
      })
      vehicleId = vehicle.id
    } catch (err) {
      // If vehicle plate already exists, skip linking
      console.error('[driver-register] vehicle create error:', err)
    }
  }

  try {
    const driver = await prisma.driver.create({
      data: {
        name: name.trim(),
        phone: phone.trim(),
        email: email?.trim() || null,
        licenseNo: licenseNo?.trim() || null,
        photoUrl: photoUrl?.trim() || null,
        isActive: false, // pending review by staff
        country: driverCountry,
        vehicleId,
        bankName: bankName?.trim() || null,
        bankAccountNo: bankAccountNo?.trim() || null,
        bankHolder: bankHolder?.trim() || null,
        bankBranch: bankBranch?.trim() || null,
        bankCode: bankCode?.trim() || null,
      },
    })

    return buildApiSuccess({ id: driver.id }, 'Registration submitted successfully')
  } catch (error) {
    return handlePrismaApiError(
      error,
      'Failed to register driver',
      'A driver with this phone number may already be registered',
    )
  }
}
