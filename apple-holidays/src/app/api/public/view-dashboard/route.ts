import { NextRequest } from 'next/server'
import { BookingStatus, type OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * Public, token-gated feed for the office "Live Screen" view dashboard (/view).
 * No login — a TV just loads /view?token=…. The token is generated & copied
 * from the admin config page and stored in SystemSetting `view_dashboard_token`.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()

  const stored = await prisma.systemSetting.findUnique({
    where: { key: 'view_dashboard_token' },
  })
  if (!stored?.value) return buildApiError('Live dashboard link is not configured yet', 404)
  if (!token || token !== stored.value) return buildApiError('Invalid dashboard link', 403)

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd   = new Date(todayStart.getTime() + 86_400_000)
  const notCancelled = { status: { not: BookingStatus.CANCELLED } }

  const [
    totalBookings,
    lifetimeByCountry,
    ongoingByCountry,
    ongoingPax,
    upcomingByCountry,
    recentBookings,
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

  return buildApiSuccess({
    generatedAt: now.toISOString(),
    totals: {
      totalBookings,
      ongoingToday:  sum(ongoing),
      upcoming:      sum(upcoming),
      paxOnTour:     (pax?.paxAdults ?? 0) + (pax?.paxChildren ?? 0) + (pax?.paxInfants ?? 0),
    },
    byCountry: { ongoing, upcoming, lifetime },
    recentBookings,
  })
}
