import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const vendors = await prisma.vehicleVendor.findMany({
    include: {
      vehicles: {
        include: { driver: { select: { id: true, name: true, phone: true } } },
        orderBy: { plateNo: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  })

  return buildApiSuccess(vendors)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { name, phone, email, address } = body
  if (!name) return buildApiError('Vendor name is required')

  const vendor = await prisma.vehicleVendor.create({
    data: { name, phone: phone || null, email: email || null, address: address || null },
  })

  return buildApiSuccess(vendor, 'Vendor created')
}
