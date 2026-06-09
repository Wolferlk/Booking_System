import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, computePNLTotals } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isClientPortalUnlocked } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import type { UserRole } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      passengers: true,
      flights: { orderBy: { date: 'asc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      itineraryItems: { orderBy: { dayNo: 'asc' } },
      emergencyContacts: true,
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: true, tickets: true },
          },
        },
      },
      pnl: { include: { lineItems: { orderBy: { sortOrder: 'asc' } } } },
      payments: { orderBy: { createdAt: 'desc' } },
      changeRequests: {
        include: { raisedBy: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
      },
      statusEvents: {
        include: { actor: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
      },
      tickets: { orderBy: { createdAt: 'desc' } },
      versions: { orderBy: { versionNo: 'desc' } },
      createdBy: { select: { id: true, name: true, role: true } },
    },
  })

  if (!booking) return buildApiError('Booking not found', 404)

  if (role === 'CLIENT') {
    if (booking.clientUserId !== session.user.id) return buildApiError('Forbidden', 403)
    if (!isClientPortalUnlocked(booking.arrivalDate)) return buildApiError('Client portal not yet available', 403)
  }

  let responseData: Record<string, unknown> = { ...booking }
  if (role === 'GT_USER' && !isClientPortalUnlocked(booking.arrivalDate)) {
    responseData.pnl = null
  }

  if (responseData.pnl && (booking as Record<string, unknown>).pnl) {
    responseData.pnl = computePNLTotals(
      (booking as Record<string, unknown>).pnl as Parameters<typeof computePNLTotals>[0]
    )
  }

  return buildApiSuccess(responseData)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const isSuperAdmin = role === 'SUPER_ADMIN'

  if (!isSuperAdmin && !hasPermission(role, 'booking:edit')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (!isSuperAdmin && !['DRAFT', 'CHANGE_REQUESTED'].includes(booking.status)) {
    return buildApiError('Booking can only be edited in DRAFT or CHANGE_REQUESTED state')
  }

  const body = await req.json()
  const {
    agentBookingId, agent, fileHandler,
    arrivalDate, departureDate, paxAdults, paxChildren,
    quotedTotal, currency, terms, exclusions, policyNotes,
    amendmentNote,
    // Super Admin can also update passengers, flights, accommodations
    passengers, flights, accommodations,
  } = body

  const updated = await prisma.booking.update({
    where: { bookingRef: params.ref },
    data: {
      ...(agentBookingId !== undefined && { agentBookingId }),
      ...(agent !== undefined && { agent }),
      ...(fileHandler !== undefined && { fileHandler }),
      ...(arrivalDate !== undefined && { arrivalDate: new Date(arrivalDate) }),
      ...(departureDate !== undefined && { departureDate: new Date(departureDate) }),
      ...(paxAdults !== undefined && { paxAdults: Number(paxAdults) }),
      ...(paxChildren !== undefined && { paxChildren: Number(paxChildren) }),
      ...(quotedTotal !== undefined && { quotedTotal: Number(quotedTotal) }),
      ...(currency !== undefined && { currency }),
      ...(terms !== undefined && { terms }),
      ...(exclusions !== undefined && { exclusions }),
      ...(policyNotes !== undefined && { policyNotes }),
      ...(amendmentNote !== undefined && { amendmentNote }),
      ...(isSuperAdmin && { version: { increment: 1 } }),
    },
  })

  // Super Admin bulk replace passengers/flights/accommodations
  if (isSuperAdmin && passengers) {
    await prisma.passenger.deleteMany({ where: { bookingId: booking.id } })
    if (passengers.length > 0) {
      await prisma.passenger.createMany({
        data: passengers.map((p: Record<string, unknown>) => ({ ...p, bookingId: booking.id })),
      })
    }
  }

  if (isSuperAdmin && flights) {
    await prisma.flight.deleteMany({ where: { bookingId: booking.id } })
    if (flights.length > 0) {
      await prisma.flight.createMany({
        data: flights.map((f: Record<string, unknown>) => ({
          ...f,
          bookingId: booking.id,
          date: f.date ? new Date(f.date as string) : new Date(),
        })),
      })
    }
  }

  if (isSuperAdmin && accommodations) {
    await prisma.accommodation.deleteMany({ where: { bookingId: booking.id } })
    if (accommodations.length > 0) {
      await prisma.accommodation.createMany({
        data: accommodations.map((a: Record<string, unknown>) => ({
          ...a,
          bookingId: booking.id,
          checkIn: a.checkIn ? new Date(a.checkIn as string) : new Date(),
          checkOut: a.checkOut ? new Date(a.checkOut as string) : new Date(),
        })),
      })
    }
  }

  await logActivity({
    userId: session.user.id,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId: params.ref,
    details: { fields: Object.keys(body), role },
  })

  return buildApiSuccess(updated, 'Booking updated')
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role !== 'SUPER_ADMIN') return buildApiError('Only Super Admin can delete bookings', 403)

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  await prisma.booking.delete({ where: { bookingRef: params.ref } })

  await logActivity({
    userId: session.user.id,
    action: ACTION.BOOKING_DELETED,
    entityType: 'Booking',
    entityId: params.ref,
    details: { bookingRef: params.ref, status: booking.status },
  })

  return buildApiSuccess(null, 'Booking permanently deleted')
}
