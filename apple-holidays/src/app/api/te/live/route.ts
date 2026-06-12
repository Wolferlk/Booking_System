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
  // mode: 'today' | 'week' | 'range'
  const mode  = searchParams.get('mode') ?? 'today'
  const from  = searchParams.get('from')
  const to    = searchParams.get('to')

  const now = new Date()
  now.setHours(0, 0, 0, 0)

  let rangeStart: Date
  let rangeEnd:   Date

  if (mode === 'today') {
    rangeStart = new Date(now)
    rangeEnd   = new Date(now); rangeEnd.setHours(23, 59, 59, 999)
  } else if (mode === 'week') {
    rangeStart = new Date(now)
    rangeEnd   = new Date(now); rangeEnd.setDate(rangeEnd.getDate() + 6); rangeEnd.setHours(23, 59, 59, 999)
  } else {
    rangeStart = from ? new Date(from) : new Date(now)
    rangeEnd   = to   ? new Date(to)   : new Date(now)
    rangeEnd.setHours(23, 59, 59, 999)
  }

  // Bookings where the trip overlaps with the selected range
  // (arrivalDate <= rangeEnd AND departureDate >= rangeStart)
  const bookings = await prisma.booking.findMany({
    where: {
      status:        { notIn: ['CANCELLED', 'DRAFT'] },
      arrivalDate:   { lte: rangeEnd },
      departureDate: { gte: rangeStart },
    },
    orderBy: { arrivalDate: 'asc' },
    include: {
      passengers:    { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      flights:       { orderBy: { date: 'asc' } },
      accommodations:{ orderBy: { checkIn: 'asc' } },
      emergencyContacts: true,
      tourAgenda:    { include: { items: { orderBy: { date: 'asc' }, take: 3 } } },
    },
  })

  return buildApiSuccess({ bookings, rangeStart, rangeEnd, count: bookings.length })
}
