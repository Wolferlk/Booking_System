import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import type { UserRole, OperationCountry, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Roles allowed to see the approval queue — matches the decision route. */
const CAN_VIEW_ROLES: UserRole[] = ['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/**
 * Cancellation approval queue for the accounts team.
 * ?view=pending (default) — awaiting a decision
 * ?view=decided           — recently approved/rejected, newest first
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!CAN_VIEW_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const view = req.nextUrl.searchParams.get('view') === 'decided' ? 'decided' : 'pending'

  const andClauses: Prisma.BookingWhereInput[] = [
    view === 'pending'
      ? { status: 'PENDING_CANCELLATION' }
      : { status: 'CANCELLED', cancelDecidedAt: { not: null } },
  ]

  // Country scoping, same pattern as the other accounts routes.
  const country = session.user.country as OperationCountry | undefined
  if (country && !canSeeAllCountries(role, country)) {
    andClauses.push({ operationCountry: country })
  }

  const bookings = await prisma.booking.findMany({
    where: { AND: andClauses },
    orderBy: view === 'pending'
      ? { cancelRequestedAt: 'asc' }   // oldest request first — it has waited longest
      : { cancelDecidedAt: 'desc' },
    take: view === 'pending' ? 200 : 50,
    select: {
      id: true, bookingRef: true, isNumber: true, agent: true, fileHandler: true,
      arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true,
      paxInfants: true, quotedTotal: true, currency: true, operationCountry: true,
      status: true, cancelPrevStatus: true, cancelRequestedAt: true,
      cancelledByName: true, cancelledByEmail: true, cancellationReason: true,
      cancellationFees: true, cancellationFeeTotal: true,
      cancelDecidedAt: true, cancelDecidedByName: true, cancelDecisionNote: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
    },
  })

  return buildApiSuccess(
    bookings.map(b => ({
      ...b,
      quotedTotal: b.quotedTotal ? b.quotedTotal.toString() : null,
      cancellationFeeTotal: b.cancellationFeeTotal ? b.cancellationFeeTotal.toString() : null,
      leadPassenger: b.passengers[0]?.name ?? null,
    })),
  )
}
