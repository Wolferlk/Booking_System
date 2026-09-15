import { readDb } from '@/lib/prisma-read'
import { buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Read-only aggregate screen — served from a read replica so the dashboard's
  // scans do not compete with the live app's writes on the primary. Falls back
  // to the primary when no replica is configured.
  const db = await readDb()


  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd   = new Date(todayStart.getTime() + 86_400_000)

  const [
    todayCheckIns,
    todayCheckOuts,
    todayFlightRows,
    lifetimeTotal,
    byStatusRaw,
    countryRaw,
    todayPax,
    recentBookings,
  ] = await Promise.all([
    db.booking.count({
      where: { arrivalDate: { gte: todayStart, lt: todayEnd }, status: { notIn: ['CANCELLED'] } },
    }),
    db.booking.count({
      where: { departureDate: { gte: todayStart, lt: todayEnd }, status: { notIn: ['CANCELLED'] } },
    }),
    db.flight.findMany({
      where: { date: { gte: todayStart, lt: todayEnd } },
      include: {
        booking: {
          select: {
            bookingRef: true,
            agent: true,
            paxAdults: true,
            paxChildren: true,
            operationCountry: true,
            status: true,
          },
        },
      },
      orderBy: { depTime: 'asc' },
    }),
    db.booking.count(),
    db.booking.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    db.booking.groupBy({
      by: ['operationCountry'],
      _count: { id: true },
    }),
    db.booking.aggregate({
      where: { arrivalDate: { gte: todayStart, lt: todayEnd }, status: { notIn: ['CANCELLED'] } },
      _sum: { paxAdults: true, paxChildren: true },
    }),
    db.booking.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      select: {
        bookingRef: true,
        agent: true,
        arrivalDate: true,
        status: true,
        operationCountry: true,
        paxAdults: true,
        paxChildren: true,
      },
    }),
  ])

  const byStatus: Record<string, number> = {}
  byStatusRaw.forEach(r => { byStatus[r.status] = r._count.id })

  const byCountry: Record<string, number> = {}
  countryRaw.forEach(r => {
    if (r.operationCountry) byCountry[r.operationCountry] = r._count.id
  })

  return buildApiSuccess({
    today: {
      checkIns:  todayCheckIns,
      checkOuts: todayCheckOuts,
      flights:   todayFlightRows.length,
      arrivals:  todayCheckIns,
      totalPax:  (todayPax._sum.paxAdults ?? 0) + (todayPax._sum.paxChildren ?? 0),
    },
    todayFlights: todayFlightRows.map(f => ({
      id:       f.id,
      flightNo: f.flightNo,
      date:     f.date,
      fromApt:  f.fromApt,
      toApt:    f.toApt,
      depTime:  f.depTime,
      arrTime:  f.arrTime,
      airline:  f.airline,
      booking:  f.booking,
    })),
    lifetime: {
      total:     lifetimeTotal,
      byCountry,
      byStatus,
    },
    recentBookings,
  })
}
