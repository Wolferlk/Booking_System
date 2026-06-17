import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { searchParams } = req.nextUrl
  const from = searchParams.get('from')
  const to   = searchParams.get('to')

  if (!from || !to) return buildApiError('"from" and "to" dates are required')

  const rangeStart = new Date(from); rangeStart.setHours(0, 0, 0, 0)
  const rangeEnd   = new Date(to);   rangeEnd.setHours(23, 59, 59, 999)

  if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) return buildApiError('Invalid date format')
  if (rangeStart > rangeEnd) return buildApiError('"from" must be on or before "to"')

  const diffDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000) + 1
  if (diffDays > 31) return buildApiError('Date range cannot exceed 31 days')

  // Single DB query: all bookings overlapping the full range
  const bookings = await prisma.booking.findMany({
    where: {
      status:        { notIn: ['CANCELLED', 'DRAFT'] },
      arrivalDate:   { lte: rangeEnd },
      departureDate: { gte: rangeStart },
    },
    orderBy: { arrivalDate: 'asc' },
    include: {
      passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      emergencyContacts: true,
      flights:           { where: { date: { gte: rangeStart, lte: rangeEnd } }, orderBy: { depTime: 'asc' } },
      accommodations:    { orderBy: { checkIn: 'asc' } },
      tourAgenda: {
        include: {
          items: {
            where:   { date: { gte: rangeStart, lte: rangeEnd } },
            orderBy: [{ meetingTime: 'asc' }, { sortOrder: 'asc' }],
          },
        },
      },
    },
  })

  // Build the list of days in the range
  const days: string[] = []
  const cur = new Date(rangeStart)
  while (cur <= rangeEnd) {
    days.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }

  // For each day, filter the pre-fetched data in-memory
  const result = days.map(dateStr => {
    const dayStart = new Date(dateStr); dayStart.setHours(0, 0, 0, 0)
    const dayEnd   = new Date(dateStr); dayEnd.setHours(23, 59, 59, 999)

    const enriched = bookings
      .filter(b => new Date(b.arrivalDate) <= dayEnd && new Date(b.departureDate) >= dayStart)
      .map(b => {
        const agendaItems = (b.tourAgenda?.items ?? []).filter(item => {
          const d = new Date(item.date); d.setHours(0, 0, 0, 0)
          return d.getTime() === dayStart.getTime()
        })
        const flights = b.flights.filter(f => {
          const d = new Date(f.date); d.setHours(0, 0, 0, 0)
          return d.getTime() === dayStart.getTime()
        })
        const checkIns = b.accommodations.filter(a => {
          const d = new Date(a.checkIn); d.setHours(0, 0, 0, 0)
          return d.getTime() === dayStart.getTime()
        })
        const checkOuts = b.accommodations.filter(a => {
          const d = new Date(a.checkOut); d.setHours(0, 0, 0, 0)
          return d.getTime() === dayStart.getTime()
        })
        const stayingAt = b.accommodations.find(a => {
          const ci = new Date(a.checkIn); ci.setHours(0, 0, 0, 0)
          const co = new Date(a.checkOut); co.setHours(0, 0, 0, 0)
          return ci <= dayStart && co > dayStart
        })

        const arrD = new Date(b.arrivalDate);   arrD.setHours(0, 0, 0, 0)
        const depD = new Date(b.departureDate); depD.setHours(0, 0, 0, 0)
        const isArriving  = arrD.getTime() === dayStart.getTime()
        const isDeparting = depD.getTime() === dayStart.getTime()
        const hasActivity =
          agendaItems.length > 0 || flights.length > 0 ||
          checkIns.length > 0 || checkOuts.length > 0 ||
          isArriving || isDeparting

        return {
          id:                b.id,
          bookingRef:        b.bookingRef,
          agent:             b.agent,
          fileHandler:       b.fileHandler,
          status:            b.status,
          paxAdults:         b.paxAdults,
          paxChildren:       b.paxChildren,
          arrivalDate:       b.arrivalDate,
          departureDate:     b.departureDate,
          passengers:        b.passengers,
          emergencyContacts: b.emergencyContacts,
          agendaItems,
          flights,
          checkIns,
          checkOuts,
          stayingAt:         stayingAt ?? null,
          isArriving,
          isDeparting,
          hasActivity,
        }
      })

    enriched.sort((a, b) => (a.hasActivity === b.hasActivity ? 0 : a.hasActivity ? -1 : 1))

    const withActivity = enriched.filter(b => b.hasActivity)
    const summary = {
      totalActive:      enriched.length,
      withActivity:     withActivity.length,
      totalFlights:     enriched.reduce((s, b) => s + b.flights.length, 0),
      totalAgendaItems: enriched.reduce((s, b) => s + b.agendaItems.length, 0),
      totalCheckIns:    enriched.reduce((s, b) => s + b.checkIns.length, 0),
      totalCheckOuts:   enriched.reduce((s, b) => s + b.checkOuts.length, 0),
      totalArrivals:    enriched.filter(b => b.isArriving).length,
      totalDepartures:  enriched.filter(b => b.isDeparting).length,
    }

    return { date: dateStr, bookings: enriched, summary }
  })

  return buildApiSuccess({ from, to, days: result })
}
