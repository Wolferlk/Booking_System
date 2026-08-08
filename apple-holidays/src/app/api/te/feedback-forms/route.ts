/**
 * All guest feedback forms across bookings (country-scoped).
 * GET — every GuestFeedbackForm submission, newest first, with booking ref/name.
 *       Powers the "All Feedbacks (Form)" tab in the AI Call Bot dashboard.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import type { UserRole, OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'
const ALLOWED_ROLES: UserRole[] = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ALLOWED_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const userCountry = session.user.country as OperationCountry | undefined
  const countryOverride = req.nextUrl.searchParams.get('country') as OperationCountry | null

  const effectiveCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? (countryOverride || null)
    : (userCountry || null)

  const where: Record<string, unknown> = effectiveCountry
    ? { booking: { operationCountry: { in: countryScope(effectiveCountry)! } } }
    : {}

  const forms = await prisma.guestFeedbackForm.findMany({
    where,
    include: {
      booking: {
        select: {
          bookingRef: true,
          operationCountry: true,
          passengers: { where: { isLead: true }, take: 1, select: { name: true } },
        },
      },
    },
    orderBy: { submittedAt: 'desc' },
    take: 500,
  })

  const data = forms.map(f => ({
    id:                 f.id,
    bookingRef:         f.booking.bookingRef,
    operationCountry:   f.booking.operationCountry,
    leadName:           f.booking.passengers[0]?.name ?? null,
    clientName:         f.clientName,
    purpose:            f.purpose,
    accommodationRoom:  f.accommodationRoom,
    accommodationFood:  f.accommodationFood,
    restaurantFood:     f.restaurantFood,
    restaurantAmbience: f.restaurantAmbience,
    transportVehicle:   f.transportVehicle,
    transportDriver:    f.transportDriver,
    overallExperience:  f.overallExperience,
    remarks:            f.remarks,
    submittedAt:        f.submittedAt.toISOString(),
  }))

  return buildApiSuccess(data)
}
