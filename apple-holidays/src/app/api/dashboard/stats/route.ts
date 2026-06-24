import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope } from '@/lib/country-detection'
import { addDays } from 'date-fns'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const userCountry = (session.user as any).country as string | undefined
  const userCountries = (session.user as any).countries as string[] | undefined
  const countryOverride = req.nextUrl.searchParams.get('country')

  // Build a country where-clause to apply to all booking queries
  const countryWhere: Record<string, unknown> = {}
  if (!canSeeAllCountries(role, userCountry as any)) {
    // Multi-country users: union of all assigned country scopes
    const multiScope = userCountryScope(userCountry, userCountries)
    if (multiScope) countryWhere.operationCountry = { in: multiScope }
  } else if (countryOverride && countryOverride !== 'ALL') {
    // Admins filtering by a specific country — expand SG/MY group properly
    const scope = countryScope(countryOverride)
    if (scope) countryWhere.operationCountry = { in: scope }
    else countryWhere.operationCountry = countryOverride
  }

  const now = new Date()
  const next7Days = addDays(now, 7)

  const [
    totalBookings,
    activeBookings,
    pendingReview,
    awaitingPayment,
    upcomingTrips,
    byStatusRaw,
  ] = await Promise.all([
    prisma.booking.count({ where: countryWhere }),
    prisma.booking.count({
      where: { ...countryWhere, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    }),
    prisma.booking.count({ where: { ...countryWhere, status: 'GT_REVIEW' } }),
    prisma.booking.count({ where: { ...countryWhere, status: 'AWAITING_PAYMENT_CONFIRM' } }),
    prisma.booking.count({
      where: {
        ...countryWhere,
        arrivalDate: { gte: now, lte: next7Days },
        status: { notIn: ['CANCELLED'] },
      },
    }),
    prisma.booking.groupBy({
      by: ['status'],
      where: countryWhere,
      _count: { _all: true },
    }),
  ])

  const byStatus: Record<string, number> = {}
  byStatusRaw.forEach(s => { byStatus[s.status] = s._count._all })

  // Profit calculation scoped to filtered bookings
  const filteredBookings = await prisma.booking.findMany({
    where: countryWhere,
    select: { id: true },
  })
  const filteredIds = filteredBookings.map(b => b.id)

  let totalRevenue = 0
  let totalCost = 0

  if (filteredIds.length > 0) {
    const allPnl = await prisma.pNL.findMany({
      where: { bookingId: { in: filteredIds } },
      include: { lineItems: true },
    })
    for (const pnl of allPnl) {
      for (const line of pnl.lineItems) {
        totalRevenue += Number(line.mmtRate)
        const totalPax = pnl.paxAdults + pnl.paxChildren
        const cost =
          (Number(line.sicRate) + Number(line.pvtRatePP) + Number(line.otherRate)) * totalPax +
          Number(line.adEntrance) * pnl.paxAdults +
          Number(line.chEntrance) * pnl.paxChildren
        totalCost += cost
      }
    }
  }

  return buildApiSuccess({
    totalBookings,
    activeBookings,
    pendingReview,
    awaitingPayment,
    upcomingTrips,
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
    byStatus,
  })
  } catch (err) {
    console.error('[Stats API] error:', err)
    return buildApiError(err instanceof Error ? err.message : 'Internal server error', 500)
  }
}
