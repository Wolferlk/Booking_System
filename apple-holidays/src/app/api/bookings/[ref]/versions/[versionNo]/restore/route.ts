import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { logActivity } from '@/lib/activity'
import { restoreBookingVersion } from '@/lib/booking-versions'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

// POST /api/bookings/[ref]/versions/[versionNo]/restore
// Switch the active version: re-point the live booking to `versionNo`.
export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string; versionNo: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const isSuperAdmin = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  if (!isSuperAdmin) return buildApiError('Forbidden — only admins can switch booking versions', 403)

  const versionNo = parseInt(params.versionNo, 10)
  if (Number.isNaN(versionNo)) return buildApiError('Invalid version number', 400)

  const booking = await prisma.booking.findUnique({
    where:  { bookingRef: params.ref },
    select: { id: true, operationCountry: true, version: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL') {
    if (!isInCountryScope(booking.operationCountry, userCountry)) return buildApiError('Forbidden', 403)
  }

  if (versionNo === booking.version) {
    return buildApiError('This version is already active', 400)
  }

  try {
    await restoreBookingVersion(booking.id, versionNo)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Failed to restore version', 400)
  }

  await logActivity({
    userId:     session.user.id,
    action:     'BOOKING_VERSION_RESTORED',
    entityType: 'Booking',
    entityId:   booking.id,
    details:    { bookingRef: params.ref, from: booking.version, to: versionNo },
  })

  return buildApiSuccess({ version: versionNo })
}
