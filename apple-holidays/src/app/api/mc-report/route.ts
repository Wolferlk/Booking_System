import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

const ALLOWED_ROLES: UserRole[] = ['TE_USER', 'GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// Merges optional search + country conditions into a single booking WHERE clause
function buildBookingWhere(
  search: string | null,
  countryWhere: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = []
  if (countryWhere) conditions.push(countryWhere)
  if (search) conditions.push({
    OR: [
      { bookingRef: { contains: search } },
      { agent:      { contains: search } },
    ],
  })
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return { AND: conditions }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ALLOWED_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const userCountry = (session.user as any).country as string | undefined
  const countryOverride = req.nextUrl.searchParams.get('country')

  // Build booking-level country filter to pass through the agenda → booking relation
  let bookingCountryWhere: Record<string, unknown> | undefined
  if (!canSeeAllCountries(role, userCountry as any)) {
    bookingCountryWhere = {
      OR: [
        { operationCountry: userCountry ?? null },
        { operationCountry: null },
      ],
    }
  } else if (countryOverride && countryOverride !== 'ALL') {
    bookingCountryWhere = { operationCountry: countryOverride }
  }

  const { searchParams } = req.nextUrl
  const dateFrom = searchParams.get('dateFrom')
  const dateTo   = searchParams.get('dateTo')
  const search   = searchParams.get('search')
  const serviceType = searchParams.get('serviceType')

  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (dateFrom) dateFilter.gte = new Date(dateFrom)
  if (dateTo) {
    const to = new Date(dateTo)
    to.setHours(23, 59, 59, 999)
    dateFilter.lte = to
  }

  const items = await prisma.agendaItem.findMany({
    where: {
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      ...(serviceType ? { serviceType: serviceType as never } : {}),
      agenda: {
        booking: buildBookingWhere(search, bookingCountryWhere),
      },
    },
    include: {
      agenda: {
        include: {
          booking: {
            select: {
              bookingRef: true,
              paxAdults:  true,
              paxChildren: true,
              agent:      true,
              status:     true,
            },
          },
        },
      },
      assignment: {
        include: {
          driver: {
            include: {
              vehicle: {
                include: { vendor: true },
              },
            },
          },
        },
      },
    },
    orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
  })

  const data = items.map(item => ({
    id:          item.id,
    date:        item.date.toISOString().slice(0, 10),
    vnCode:      item.agenda.booking.bookingRef,
    location:    item.location,
    paxAdults:   item.agenda.booking.paxAdults,
    paxChildren: item.agenda.booking.paxChildren,
    fromPoint:   item.fromPoint ?? null,
    toPoint:     item.toPoint   ?? null,
    details:     item.details   ?? null,
    mealPlan:    item.mealPlan  ?? null,
    meetingTime: item.meetingTime ?? null,
    serviceType: item.serviceType,
    vendor:      item.assignment?.driver?.vehicle?.vendor?.name
                   ?? item.assignment?.driverName
                   ?? null,
    driverName:  item.assignment?.driverName ?? item.assignment?.driver?.name ?? null,
    vehicleType: item.assignment?.vehicleType  ?? null,
    vehiclePlate: item.assignment?.vehiclePlate ?? null,
    agent:        item.agenda.booking.agent    ?? null,
    bookingStatus: item.agenda.booking.status,
  }))

  return buildApiSuccess(data)
}
