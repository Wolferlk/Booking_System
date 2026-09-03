import { NextRequest } from 'next/server'
import { BookingStatus, type OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * Public feed for the office "Live Screen" view dashboard (/view).
 * No login and no token — the link is permanent and never expires. A TV just
 * loads /view and it works forever. Data is read-only aggregate booking counts,
 * so there is no sensitive per-record exposure. Keep the link internal.
 */
export async function GET(_req: NextRequest) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd   = new Date(todayStart.getTime() + 86_400_000)
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)
  const notCancelled = { status: { not: BookingStatus.CANCELLED } }

  const [
    totalBookings,
    lifetimeByCountry,
    ongoingByCountry,
    ongoingPax,
    upcomingByCountry,
    recentBookings,
    todayArrivalFlights,
    todayFlightsTotal,
    createdToday,
    createdYesterdayToNow,
  ] = await Promise.all([
    // Total lifetime bookings (excl cancelled) — the always-on headline number.
    prisma.booking.count({ where: notCancelled }),

    // Lifetime bookings per country.
    prisma.booking.groupBy({
      by: ['operationCountry'],
      where: notCancelled,
      _count: { id: true },
    }),

    // Tours in progress TODAY (arrived on/before today, departing on/after today).
    prisma.booking.groupBy({
      by: ['operationCountry'],
      where: {
        ...notCancelled,
        arrivalDate:   { lt: todayEnd },
        departureDate: { gte: todayStart },
      },
      _count: { id: true },
    }),

    // Pax on tour today.
    prisma.booking.aggregate({
      where: {
        ...notCancelled,
        arrivalDate:   { lt: todayEnd },
        departureDate: { gte: todayStart },
      },
      _sum: { paxAdults: true, paxChildren: true, paxInfants: true },
    }),

    // Upcoming tours (arriving from tomorrow onward).
    prisma.booking.groupBy({
      by: ['operationCountry'],
      where: { ...notCancelled, arrivalDate: { gte: todayEnd } },
      _count: { id: true },
    }),

    // Newest bookings — drives the sound-alert popups on the screen.
    prisma.booking.findMany({
      where: notCancelled,
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        bookingRef: true,
        agent: true,
        operationCountry: true,
        paxAdults: true,
        paxChildren: true,
        arrivalDate: true,
        departureDate: true,
        createdAt: true,
      },
    }),

    // Today's ARRIVAL flights — inbound flights for tours landing today.
    prisma.flight.count({
      where: {
        date: { gte: todayStart, lt: todayEnd },
        booking: { ...notCancelled, arrivalDate: { gte: todayStart, lt: todayEnd } },
      },
    }),

    // Every flight scheduled today (arrivals + departures + internal legs).
    prisma.flight.count({
      where: { date: { gte: todayStart, lt: todayEnd } },
    }),

    // Everything booked since midnight. Read as rows rather than counted so the
    // screen can draw the shape of the day (per hour, per country) off one
    // query — a day's intake is tens of rows, not thousands.
    prisma.booking.findMany({
      where: { ...notCancelled, createdAt: { gte: todayStart, lt: todayEnd } },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true, operationCountry: true,
        paxAdults: true, paxChildren: true, paxInfants: true,
      },
    }),

    // Yesterday up to this same clock time — the only honest comparison for a
    // day still in progress. Yesterday's *full* total would make every morning
    // look like a collapse.
    prisma.booking.count({
      where: {
        ...notCancelled,
        createdAt: { gte: yesterdayStart, lt: new Date(now.getTime() - 86_400_000) },
      },
    }),
  ])

  const toMap = (rows: { operationCountry: OperationCountry | null; _count: { id: number } }[]) => {
    const m: Record<string, number> = {}
    rows.forEach(r => { if (r.operationCountry) m[r.operationCountry] = r._count.id })
    return m
  }

  const ongoing  = toMap(ongoingByCountry)
  const upcoming = toMap(upcomingByCountry)
  const lifetime = toMap(lifetimeByCountry)

  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0)
  const pax = ongoingPax._sum

  // The day's intake, shaped for the screen: 24 hourly buckets for the
  // sparkline, a country split for the dots, and the pax it represents.
  const createdByHour = Array.from({ length: 24 }, () => 0)
  const createdByCountry: Record<string, number> = {}
  let createdPax = 0
  for (const b of createdToday) {
    createdByHour[b.createdAt.getHours()] += 1
    if (b.operationCountry) createdByCountry[b.operationCountry] = (createdByCountry[b.operationCountry] ?? 0) + 1
    createdPax += b.paxAdults + b.paxChildren + b.paxInfants
  }
  const lastCreatedAt = createdToday.length ? createdToday[createdToday.length - 1].createdAt.toISOString() : null

  return buildApiSuccess({
    generatedAt: now.toISOString(),
    totals: {
      totalBookings,
      ongoingToday:  sum(ongoing),
      upcoming:      sum(upcoming),
      paxOnTour:     (pax?.paxAdults ?? 0) + (pax?.paxChildren ?? 0) + (pax?.paxInfants ?? 0),
      arrivalFlightsToday: todayArrivalFlights,
      flightsToday:  todayFlightsTotal,
      createdToday:  createdToday.length,
      createdTodayPax: createdPax,
      /** Yesterday to this same minute, so the delta compares like with like. */
      createdYesterdayToNow,
    },
    createdTodayByHour: createdByHour,
    lastCreatedAt,
    byCountry: { ongoing, upcoming, lifetime, createdToday: createdByCountry },
    recentBookings,
  })
}
