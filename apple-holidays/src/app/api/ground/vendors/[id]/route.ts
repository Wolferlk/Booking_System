import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { name, phone, email, address, isActive } = body

  const vendor = await prisma.vehicleVendor.update({
    where: { id: params.id },
    data: {
      name: name || undefined,
      phone: phone ?? null,
      email: email ?? null,
      address: address ?? null,
      isActive: isActive ?? undefined,
    },
  })

  return buildApiSuccess(vendor, 'Vendor updated')
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  await prisma.vehicleVendor.delete({ where: { id: params.id } })
  return buildApiSuccess(null, 'Vendor deleted')
}
