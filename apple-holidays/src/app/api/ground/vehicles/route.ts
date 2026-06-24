import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const all = searchParams.get('all') === '1'

  const vehicles = await prisma.vehicle.findMany({
    where: all ? {} : { isActive: true },
    include: {
      driver: { select: { id: true, name: true, phone: true } },
      vendor: { select: { id: true, name: true } },
    },
    orderBy: { plateNo: 'asc' },
  })

  return buildApiSuccess(vehicles)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { type, plateNo, brand, model, capacity, description, photoOutside, photoInside, vendorId } = body
  if (!type || !plateNo) return buildApiError('type and plateNo are required')

  const vehicle = await prisma.vehicle.create({
    data: {
      type,
      plateNo,
      brand: brand || null,
      model: model || null,
      capacity: Number(capacity) || 4,
      description: description || null,
      photoOutside: photoOutside || null,
      photoInside: photoInside || null,
      vendorId: vendorId || null,
    },
    include: { driver: true, vendor: true },
  })

  return buildApiSuccess(vehicle, 'Vehicle added')
}
