import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const role = session.user.role as UserRole
  const userCountry = (session.user as any).country as string | undefined
  const countryOverride = req.nextUrl.searchParams.get('country')

  const countryWhere: Record<string, unknown> = {}
  if (!canSeeAllCountries(role, userCountry as any)) {
    // Country-scoped users: strict match only — never include unassigned (null) bookings
    if (userCountry && userCountry !== 'ALL') {
      countryWhere.operationCountry = userCountry
    }
  } else if (countryOverride && countryOverride !== 'ALL') {
    countryWhere.operationCountry = countryOverride
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
      ...countryWhere,
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
