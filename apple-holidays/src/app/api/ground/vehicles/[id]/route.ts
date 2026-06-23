import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { type, plateNo, brand, model, capacity, description, photoOutside, photoInside, isActive, vendorId } = body

  const vehicle = await prisma.vehicle.update({
    where: { id: params.id },
    data: {
      ...(type !== undefined && { type }),
      ...(plateNo !== undefined && { plateNo }),
      ...(brand !== undefined && { brand }),
      ...(model !== undefined && { model }),
      ...(capacity !== undefined && { capacity: Number(capacity) }),
      ...(description !== undefined && { description }),
      ...(photoOutside !== undefined && { photoOutside }),
      ...(photoInside !== undefined && { photoInside }),
      ...(isActive !== undefined && { isActive }),
      ...(vendorId !== undefined && { vendorId: vendorId || null }),
    },
    include: { driver: true, vendor: true },
  })

  return buildApiSuccess(vehicle, 'Vehicle updated')
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  await prisma.vehicle.delete({ where: { id: params.id } })
  return buildApiSuccess(null, 'Vehicle deleted')
}
