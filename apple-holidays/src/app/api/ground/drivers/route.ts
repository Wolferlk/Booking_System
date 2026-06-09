import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const showAll = searchParams.get('all') === '1'

  const drivers = await prisma.driver.findMany({
    where: showAll ? {} : {},
    include: { vehicle: { include: { vendor: true } } },
    orderBy: { name: 'asc' },
  })

  return buildApiSuccess(drivers)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { name, phone, email, licenseNo, vehicleId, bankName, bankAccountNo, bankHolder, bankBranch, bankCode, isActive, photoUrl } = body
  if (!name || !phone) return buildApiError('name and phone are required')

  const driver = await prisma.driver.create({
    data: {
      name, phone,
      email: email || null,
      licenseNo: licenseNo || null,
      isActive: isActive ?? true,
      photoUrl: photoUrl || null,
      vehicleId: vehicleId || null,
      bankName: bankName || null,
      bankAccountNo: bankAccountNo || null,
      bankHolder: bankHolder || null,
      bankBranch: bankBranch || null,
      bankCode: bankCode || null,
    },
    include: { vehicle: { include: { vendor: true } } },
  })

  await logActivity({
    userId: session.user.id,
    action: ACTION.DRIVER_CREATED,
    entityType: 'Driver',
    entityId: driver.id,
    details: { name: driver.name },
  })

  return buildApiSuccess(driver, 'Driver added')
}
