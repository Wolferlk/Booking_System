import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const role = session.user.role as UserRole
  const userCountry = (session.user as any).country as string | undefined
  const countryOverride = req.nextUrl.searchParams.get('country')

  // Admin explicit narrowing: SINGAPORE / MALAYSIA match their own value PLUS any
  // legacy SINGAPORE_MALAYSIA bookings carrying the matching ref prefix.
  function adminCountryWhere(country: string): Record<string, unknown> {
    if (country === 'SINGAPORE') return { OR: [{ operationCountry: 'SINGAPORE' }, { operationCountry: 'SINGAPORE_MALAYSIA', bookingRef: { startsWith: 'SG' } }] }
    if (country === 'MALAYSIA')  return { OR: [{ operationCountry: 'MALAYSIA' }, { operationCountry: 'SINGAPORE_MALAYSIA', bookingRef: { startsWith: 'MY' } }] }
    if (country === 'SINGAPORE_MALAYSIA') return { operationCountry: { in: countryScope(country)! } }
    return { operationCountry: country }
  }

  let countryWhere: Record<string, unknown> = {}
  if (!canSeeAllCountries(role, userCountry as any)) {
    const scope = countryScope(userCountry)
    if (scope) countryWhere = { operationCountry: { in: scope } }
  } else if (countryOverride && countryOverride !== 'ALL') {
    countryWhere = adminCountryWhere(countryOverride)
  }

  // All operational bookings with upcoming / current trips
  const bookings = await prisma.booking.findMany({
    where: {
      ...countryWhere,
      status: { in: ['OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS'] },
    },
    include: {
      passengers: { where: { isLead: true }, take: 1 },
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: {
              assignment: {
                include: { driver: { select: { id: true, name: true, phone: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { arrivalDate: 'asc' },
  })

  // Build flat list of agenda items with booking context, grouped by date
  const slots = bookings.flatMap(b =>
    (b.tourAgenda?.items ?? []).map(item => ({
      agendaItemId:  item.id,
      bookingRef:    b.bookingRef,
      bookingStatus: b.status,
      arrivalDate:   b.arrivalDate,
      departureDate: b.departureDate,
      leadPassenger: b.passengers[0]?.name ?? null,
      paxAdults:     b.paxAdults,
      paxChildren:   b.paxChildren,
      date:          item.date,
      location:      item.location,
      fromPoint:     item.fromPoint,
      toPoint:       item.toPoint,
      details:       item.details,
      meetingTime:   item.meetingTime,
      serviceType:   item.serviceType,
      assignment:    item.assignment
        ? {
            id:           item.assignment.id,
            driverId:     item.assignment.driverId,
            driverName:   item.assignment.driverName,
            driverPhone:  item.assignment.driverPhone,
            vehicleType:  item.assignment.vehicleType,
            vehiclePlate: item.assignment.vehiclePlate,
            notes:        item.assignment.notes,
            driver:       item.assignment.driver ?? null,
          }
        : null,
    })),
  )

  // Sort by date ascending
  slots.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  return buildApiSuccess(slots)
}
