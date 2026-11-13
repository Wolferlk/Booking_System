/**
 * GET /api/bookings/[ref]/logs?section=contact&before=ISO&limit=60
 *
 * One booking's history for a section drawer (or every section when omitted).
 * Read-only. See lib/booking-logs.ts for the sources merged.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { isLogSection, readLogs } from '@/lib/booking-logs'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref }, select: { bookingRef: true, operationCountry: true } })
  // A deleted booking still has history — only scope-check one that exists.
  if (booking) {
    const userCountry = session.user.country as string | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!canSeeAllCountries(role, userCountry as any) && userCountry && userCountry !== 'ALL' &&
        !isInCountryScope(booking.operationCountry, userCountry)) {
      return buildApiError('Forbidden', 403)
    }
  }

  const sp = req.nextUrl.searchParams
  const section = sp.get('section')
  const before = sp.get('before')
  const data = await readLogs({
    bookingRef: params.ref,
    section: isLogSection(section) ? section : null,
    q: sp.get('q'),
    tone: sp.get('failed') === '1' ? 'fail' : null,
    before: before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null,
    limit: Number(sp.get('limit')) || 60,
  })
  return buildApiSuccess(data)
}
