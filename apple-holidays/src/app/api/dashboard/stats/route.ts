import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { addDays } from 'date-fns'
import type { UserRole } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const destFilter = role !== 'SUPER_ADMIN' ? { destination: session.user.destination } : {}

  const now = new Date()
  const next30Days = addDays(now, 30)

  const [
    totalBookings,
    activeBookings,
    pendingReview,
    awaitingPayment,
    upcomingTrips,
    byStatusRaw,
    pnlAggregate,
  ] = await Promise.all([
    prisma.booking.count({ where: destFilter }),
    prisma.booking.count({
      where: {
        ...destFilter,
        status: {
          notIn: ['COMPLETED', 'CANCELLED'],
        },
      },
    }),
    prisma.booking.count({ where: { ...destFilter, status: 'GT_REVIEW' } }),
    prisma.booking.count({ where: { ...destFilter, status: 'AWAITING_PAYMENT_CONFIRM' } }),
    prisma.booking.count({
      where: {
        ...destFilter,
        arrivalDate: { gte: now, lte: next30Days },
        status: { notIn: ['CANCELLED'] },
      },
    }),
    prisma.booking.groupBy({
      by: ['status'],
      where: destFilter,
      _count: { _all: true },
    }),
    prisma.pNLLineItem.aggregate({
      _sum: { mmtRate: true },
    }),
  ])

  const byStatus: Record<string, number> = {}
  byStatusRaw.forEach(s => {
    byStatus[s.status] = s._count._all
  })

  // Simplified profit calculation — filtered by destination
  const allPnl = await prisma.pNL.findMany({
    where: { booking: destFilter },
    include: { lineItems: true },
  })

  let totalRevenue = 0
  let totalCost = 0

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
}
