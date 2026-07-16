import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

// GET /api/bookings/[ref]/versions/[versionNo]
// Returns the parsed full snapshot for a single version (read-only preview).
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string; versionNo: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const versionNo = parseInt(params.versionNo, 10)
  if (Number.isNaN(versionNo)) return buildApiError('Invalid version number', 400)

  const booking = await prisma.booking.findUnique({
    where:  { bookingRef: params.ref },
    select: { id: true, operationCountry: true, version: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = session.user.country as string | undefined
  if (role !== 'CLIENT' && !canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL') {
    if (!isInCountryScope(booking.operationCountry, userCountry)) return buildApiError('Forbidden', 403)
  }

  const version = await prisma.bookingVersion.findUnique({
    where: { bookingId_versionNo: { bookingId: booking.id, versionNo } },
  })
  if (!version) return buildApiError('Version not found', 404)

  let snapshot: unknown = null
  try {
    snapshot = version.docSnapshot ? JSON.parse(version.docSnapshot) : null
  } catch {
    snapshot = null
  }

  return buildApiSuccess({
    versionNo:     version.versionNo,
    source:        version.source,
    amendmentNote: version.amendmentNote,
    createdAt:     version.createdAt,
    isActive:      version.versionNo === booking.version,
    snapshot,
  })
}
