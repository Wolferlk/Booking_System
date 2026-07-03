import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const vehicle = await prisma.vehicle.findFirst({ where: { id: params.id, vendorId: session.id } })
  if (!vehicle) return buildApiError('Not found', 404)

  const { type, brand, model, capacity, photoOutside, photoInside, isActive } = await req.json()

  const updated = await prisma.vehicle.update({
    where: { id: params.id },
    data: {
      type: type || undefined,
      brand: brand?.trim() || null,
      model: model?.trim() || null,
      capacity: capacity ? parseInt(capacity, 10) : undefined,
      photoOutside: photoOutside || null,
      photoInside: photoInside || null,
      isActive: isActive ?? undefined,
    },
    include: { driver: { select: { id: true, name: true } } },
  })

  return buildApiSuccess(updated, 'Vehicle updated')
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const vehicle = await prisma.vehicle.findFirst({ where: { id: params.id, vendorId: session.id } })
  if (!vehicle) return buildApiError('Not found', 404)

  await prisma.vehicle.delete({ where: { id: params.id } })
  return buildApiSuccess(null, 'Vehicle removed')
}
