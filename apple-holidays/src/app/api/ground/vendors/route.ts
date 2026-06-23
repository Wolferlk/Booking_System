import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'
import type { OperationCountry } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const userCountry = session.user.country as OperationCountry | undefined
  const countryOverride = req.nextUrl.searchParams.get('country') as OperationCountry | null

  const effectiveCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? (countryOverride || null)
    : (userCountry || null)

  const vendors = await prisma.vehicleVendor.findMany({
    where: effectiveCountry ? { country: { in: countryScope(effectiveCountry)! } } : {},
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
  if (!['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { name, phone, email, address, country } = body
  if (!name) return buildApiError('Vendor name is required')

  const role = session.user.role as UserRole
  const userCountry = session.user.country as OperationCountry | undefined
  const vendorCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? (country || null)
    : (userCountry || null)

  const vendor = await prisma.vehicleVendor.create({
    data: {
      name,
      phone:   phone   || null,
      email:   email   || null,
      address: address || null,
      country: vendorCountry as OperationCountry || null,
    },
  })

  return buildApiSuccess(vendor, 'Vendor created')
}
