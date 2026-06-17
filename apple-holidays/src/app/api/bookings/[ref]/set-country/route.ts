import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { OPERATION_COUNTRIES } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'booking:set_country')) {
    return buildApiError('Forbidden — only admins can assign country to a booking', 403)
  }

  const { country } = await req.json() as { country: string | null }

  const validCountries = OPERATION_COUNTRIES.map(c => c.value)
  if (country !== null && !validCountries.includes(country as any)) {
    return buildApiError(`Invalid country. Must be one of: ${validCountries.join(', ')} or null`)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  const updated = await (prisma.booking as any).update({
    where: { bookingRef: params.ref },
    data:  { operationCountry: country ?? null },
    select: { bookingRef: true, operationCountry: true },
  })

  return buildApiSuccess(updated, `Booking ${params.ref} assigned to ${country ?? 'unassigned'}`)
}
