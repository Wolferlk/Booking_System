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
  const dateParam = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  const dayStart = new Date(dateParam); dayStart.setHours(0, 0, 0, 0)
  const dayEnd   = new Date(dateParam); dayEnd.setHours(23, 59, 59, 999)

  // All bookings whose trip overlaps with this day
  const bookings = await prisma.booking.findMany({
    where: {
      status:        { notIn: ['CANCELLED', 'DRAFT'] },
      arrivalDate:   { lte: dayEnd },
      departureDate: { gte: dayStart },
    },
    orderBy: { arrivalDate: 'asc' },
    include: {
      passengers:       { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      emergencyContacts: true,
      flights: {
        where: { date: { gte: dayStart, lte: dayEnd } },
        orderBy: { depTime: 'asc' },
      },
      accommodations: {
        orderBy: { checkIn: 'asc' },
      },
      tourAgenda: {
        include: {
          items: {
            where: { date: { gte: dayStart, lte: dayEnd } },
            orderBy: [{ meetingTime: 'asc' }, { sortOrder: 'asc' }],
          },
        },
      },
    },
  })

  const enriched = bookings.map(b => {
    const agendaItems = b.tourAgenda?.items ?? []
    const flights     = b.flights

    const checkIns  = b.accommodations.filter(a => {
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
      id:               b.id,
      bookingRef:       b.bookingRef,
      agent:            b.agent,
      fileHandler:      b.fileHandler,
      status:           b.status,
      paxAdults:        b.paxAdults,
      paxChildren:      b.paxChildren,
      arrivalDate:      b.arrivalDate,
      departureDate:    b.departureDate,
      passengers:       b.passengers,
      emergencyContacts:b.emergencyContacts,
      agendaItems,
      flights,
      checkIns,
      checkOuts,
      stayingAt:        stayingAt ?? null,
      isArriving,
      isDeparting,
      hasActivity,
    }
  })

  // Bookings with activity on this day first, then others
  enriched.sort((a, b) => {
    if (a.hasActivity && !b.hasActivity) return -1
    if (!a.hasActivity && b.hasActivity) return 1
    return 0
  })

  const withActivity = enriched.filter(b => b.hasActivity)
  const summary = {
    totalActive:       enriched.length,
    withActivity:      withActivity.length,
    totalFlights:      enriched.reduce((s, b) => s + b.flights.length, 0),
    totalAgendaItems:  enriched.reduce((s, b) => s + b.agendaItems.length, 0),
    totalCheckIns:     enriched.reduce((s, b) => s + b.checkIns.length, 0),
    totalCheckOuts:    enriched.reduce((s, b) => s + b.checkOuts.length, 0),
    totalArrivals:     enriched.filter(b => b.isArriving).length,
    totalDepartures:   enriched.filter(b => b.isDeparting).length,
  }

  return buildApiSuccess({ date: dateParam, bookings: enriched, summary })
}
