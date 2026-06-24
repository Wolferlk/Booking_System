import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const driver = await prisma.driver.findUnique({
    where: { id: params.id },
    include: {
      vehicle: true,
      driverPayments: {
        include: { paidBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!driver) return buildApiError('Driver not found', 404)
  return buildApiSuccess(driver)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const driver = await prisma.driver.findUnique({ where: { id: params.id } })
  if (!driver) return buildApiError('Driver not found', 404)

  const body = await req.json()
  const {
    name, phone, email, licenseNo, isActive, photoUrl,
    vehicleId, country,
    bankName, bankAccountNo, bankHolder, bankBranch, bankCode,
  } = body

  // Only ALL-country users can change the driver's country
  const userCountry = session.user.country as string | undefined

  const updated = await prisma.driver.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(phone !== undefined && { phone }),
      ...(email !== undefined && { email }),
      ...(licenseNo !== undefined && { licenseNo }),
      ...(isActive !== undefined && { isActive }),
      ...(photoUrl !== undefined && { photoUrl }),
      ...(vehicleId !== undefined && { vehicleId: vehicleId || null }),
      ...(country !== undefined && (!userCountry || userCountry === 'ALL') && { country: country || null }),
      ...(bankName !== undefined && { bankName }),
      ...(bankAccountNo !== undefined && { bankAccountNo }),
      ...(bankHolder !== undefined && { bankHolder }),
      ...(bankBranch !== undefined && { bankBranch }),
      ...(bankCode !== undefined && { bankCode }),
    },
    include: { vehicle: { include: { vendor: true } } },
  })

  await logActivity({
    userId: session.user.id,
    action: ACTION.DRIVER_UPDATED,
    entityType: 'Driver',
    entityId: params.id,
    details: { name: updated.name, fields: Object.keys(body) },
  })

  return buildApiSuccess(updated, 'Driver updated')
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  await prisma.driver.delete({ where: { id: params.id } })
  return buildApiSuccess(null, 'Driver deleted')
}
