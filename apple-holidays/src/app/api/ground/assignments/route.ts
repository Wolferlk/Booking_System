import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  // All operational bookings with upcoming / current trips
  const bookings = await prisma.booking.findMany({
    where: {
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
