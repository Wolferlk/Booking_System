import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { searchParams } = req.nextUrl
  const fromA = searchParams.get('fromA') // Period A start
  const toA   = searchParams.get('toA')   // Period A end
  const fromB = searchParams.get('fromB') // Period B start (compare)
  const toB   = searchParams.get('toB')   // Period B end

  const now = new Date()
  // Default Period A: current month
  const defFromA = new Date(now.getFullYear(), now.getMonth(), 1)
  const defToA   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  // Default Period B: last month
  const defFromB = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const defToB   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

  const periodA = {
    start: fromA ? new Date(fromA) : defFromA,
    end:   toA   ? new Date(toA)   : defToA,
  }
  const periodB = {
    start: fromB ? new Date(fromB) : defFromB,
    end:   toB   ? new Date(toB)   : defToB,
  }

  async function getStats(start: Date, end: Date) {
    const bookings = await prisma.booking.findMany({
      where: {
        arrivalDate: { gte: start, lte: end },
        status: { notIn: ['CANCELLED'] },
      },
      include: {
        passengers: { select: { type: true } },
        _count: { select: { passengers: true } },
      },
    })

    const cancelled = await prisma.booking.count({
      where: { arrivalDate: { gte: start, lte: end }, status: 'CANCELLED' },
    })

    const byStatus: Record<string, number> = {}
    let totalAdults = 0, totalChildren = 0, totalRevenue = 0
    const byAgent: Record<string, number> = {}

    for (const b of bookings) {
      byStatus[b.status] = (byStatus[b.status] ?? 0) + 1
      const agent = b.agent ?? 'Unknown'
      byAgent[agent] = (byAgent[agent] ?? 0) + 1
      totalAdults   += b.paxAdults
      totalChildren += b.paxChildren
      if (b.quotedTotal) totalRevenue += Number(b.quotedTotal)
    }

    const topAgents = Object.entries(byAgent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([agent, count]) => ({ agent, count }))

    return {
      total: bookings.length,
      cancelled,
      byStatus,
      totalPax: totalAdults + totalChildren,
      totalAdults,
      totalChildren,
      totalRevenue,
      topAgents,
    }
  }

  const [statsA, statsB] = await Promise.all([
    getStats(periodA.start, periodA.end),
    getStats(periodB.start, periodB.end),
  ])

  // Status distribution for current month (all statuses)
  const allStatuses = await prisma.booking.groupBy({
    by: ['status'],
    _count: { id: true },
    where: { arrivalDate: { gte: periodA.start, lte: periodA.end } },
  })

  return buildApiSuccess({
    periodA: { ...periodA, stats: statsA },
    periodB: { ...periodB, stats: statsB },
    statusDistribution: allStatuses.map(s => ({ status: s.status, count: s._count.id })),
  })
}
