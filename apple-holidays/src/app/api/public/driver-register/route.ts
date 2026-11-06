import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { handlePrismaApiError } from '@/lib/prisma-error'
import type { OperationCountry } from '@prisma/client'
import { recordWebDriverSignup } from '@/lib/mobile/signup'
import { vehicleProblem } from '@/lib/vehicle-details'

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
    const plateNo = vehiclePlateNo.trim().toUpperCase()
    const problem = vehicleProblem({ type: vehicleType, brand: vehicleBrand, model: vehicleModel, capacity: vehicleCapacity })
    if (problem) return buildApiError(problem)
    if (await prisma.vehicle.findUnique({ where: { plateNo }, select: { id: true } })) {
      return buildApiError(`${plateNo} is already registered with us. If it is yours, please contact operations.`, 409)
    }
    const vehicle = await prisma.vehicle.create({
      data: {
        type: vehicleType,
        plateNo,
        brand: vehicleBrand.trim(),
        model: vehicleModel.trim(),
        capacity: Number(vehicleCapacity),
        photoOutside: vehiclePhotoOutside?.trim() || null,
        photoInside: vehiclePhotoInside?.trim() || null,
      },
    })
    vehicleId = vehicle.id
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

    // Lists it under "Waiting for approval" on the Drivers page (best effort).
    await recordWebDriverSignup(driver)

    return buildApiSuccess({ id: driver.id }, 'Registration submitted successfully')
  } catch (error) {
    return handlePrismaApiError(
      error,
      'Failed to register driver',
      'A driver with this phone number may already be registered',
    )
  }
}
