import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, isClientPortalUnlocked } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      passengers: true,
      flights: { orderBy: { date: 'asc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      itineraryItems: { orderBy: { dayNo: 'asc' } },
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: true },
          },
        },
      },
      payments: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!booking) return buildApiError('Booking not found', 404)

  if (!isClientPortalUnlocked(booking.arrivalDate)) {
    return buildApiError('Client portal is not yet available (opens T−5)', 403)
  }

  // Strip cost/profit data for clients
  const role = session.user.role as UserRole
  const isStaff = ['BT_USER', 'GT_USER', 'TE_USER', 'AC_USER', 'SUPER_ADMIN'].includes(role)

  // Build client-safe response
  const portalData = {
    bookingRef: booking.bookingRef,
    status: booking.status,
    arrivalDate: booking.arrivalDate,
    departureDate: booking.departureDate,
    paxAdults: booking.paxAdults,
    paxChildren: booking.paxChildren,
    agent: booking.agent,
    passengers: booking.passengers,
    flights: booking.flights,
    accommodations: booking.accommodations,
    itinerary: booking.itineraryItems,
    agenda: booking.tourAgenda
      ? {
          ...booking.tourAgenda,
          items: booking.tourAgenda.items.map(item => ({
            id: item.id,
            date: item.date,
            location: item.location,
            fromPoint: item.fromPoint,
            toPoint: item.toPoint,
            details: item.details,
            mealPlan: item.mealPlan,
            meetingTime: item.meetingTime,
            serviceType: item.serviceType,
            assignment: item.assignment
              ? {
                  driverName: item.assignment.driverName,
                  driverPhone: item.assignment.driverPhone,
                  vehicleType: item.assignment.vehicleType,
                  vehiclePlate: item.assignment.vehiclePlate,
                }
              : null,
          })),
        }
      : null,
    payments: booking.payments.map(p => ({
      id: p.id,
      type: p.type,
      label: p.label ?? null,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      method: p.method,
      paidAt: p.paidAt,
      refNumber: p.refNumber ?? null,
    })),
  }

  return buildApiSuccess(portalData)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  // Client posting an update request
  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (!isClientPortalUnlocked(booking.arrivalDate)) {
    return buildApiError('Portal not yet available', 403)
  }

  const { notes, targetField } = await req.json()
  if (!notes) return buildApiError('Notes are required')

  const changeRequest = await prisma.changeRequest.create({
    data: {
      bookingId: booking.id,
      raisedById: session.user.id,
      notes,
      targetField: targetField ?? 'client_request',
    },
  })

  return buildApiSuccess(changeRequest, 'Update request submitted')
}
