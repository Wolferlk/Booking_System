import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  })

  return buildApiSuccess(drivers)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  if (!['GT_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { name, phone, email, licenseNo } = await req.json()
  if (!name || !phone) return buildApiError('name and phone are required')

  const driver = await prisma.driver.create({
    data: { name, phone, email, licenseNo },
  })

  return buildApiSuccess(driver, 'Driver added')
}
