import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    orderBy: { type: 'asc' },
  })

  return buildApiSuccess(vehicles)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  if (!['GT_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { type, plateNo, capacity, description } = await req.json()
  if (!type || !plateNo || !capacity) return buildApiError('type, plateNo, and capacity are required')

  const vehicle = await prisma.vehicle.create({
    data: { type, plateNo, capacity: Number(capacity), description },
  })

  return buildApiSuccess(vehicle, 'Vehicle added')
}
