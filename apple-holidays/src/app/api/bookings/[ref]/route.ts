import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, computePNLTotals } from '@/lib/utils'
import { hasPermission, canSeeAllCountries } from '@/lib/rbac'
import { isClientPortalUnlocked } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import { isInCountryScope } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
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

  const userCountry = session.user.country as string | undefined
  if (role !== 'CLIENT' && !canSeeAllCountries(role, userCountry as any) && userCountry && userCountry !== 'ALL') {
    if (!isInCountryScope(booking.operationCountry, userCountry)) {
      return buildApiError('Forbidden', 403)
    }
  }

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
  const isSuperAdmin = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  // GT, BT, TE, GT_TE can edit accommodation/vehicle fields during change requests
  const canEdit = isSuperAdmin || hasPermission(role, 'booking:edit') ||
    ['GT_USER', 'BT_USER', 'TE_USER', 'GT_TE_USER'].includes(role)

  if (!canEdit) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as any) && userCountry && userCountry !== 'ALL' && !isInCountryScope(booking.operationCountry, userCountry)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json()
  const {
    agentBookingId, agent, fileHandler,
    arrivalDate, departureDate, paxAdults, paxChildren,
    quotedTotal, currency, terms, exclusions, policyNotes,
    amendmentNote,
    // TC identifier fields (editable by BT/GT/SA)
    isNumber,
    // Contact info fields (editable at any booking status)
    agentEmail, agentPhone, agentWhatsapp, agentAddress,
    contactEmail, contactPhone, contactWhatsapp, contactAddress,
    // Country (always editable)
    operationCountry,
    // Super Admin can also update passengers, flights, accommodations
    passengers, flights, accommodations,
    // GT/BT/TE can update accommodation room types and vehicle changes
    accommodationUpdates,
    // TE/BT/SUPER_ADMIN can update individual flights (cancellations, reschedules)
    flightUpdates, flightAdds, flightDeletes,
  } = body

  // Flight updates are allowed at any booking status for emergency situations (cancelled/missing flights)
  const isFlightOnlyUpdate = (flightUpdates || flightAdds || flightDeletes) &&
    !agentBookingId && !agent && !fileHandler && !arrivalDate && !departureDate &&
    !paxAdults && !paxChildren && !quotedTotal && !currency && !terms && !exclusions &&
    !policyNotes && !amendmentNote && !passengers && !flights && !accommodations && !accommodationUpdates

  // Contact info, country, and TC identifier updates are allowed at any booking status
  const isContactOnlyUpdate = (agentEmail !== undefined || agentPhone !== undefined || agentWhatsapp !== undefined || agentAddress !== undefined ||
    contactEmail !== undefined || contactPhone !== undefined || contactWhatsapp !== undefined || contactAddress !== undefined ||
    operationCountry !== undefined || isNumber !== undefined || agentBookingId !== undefined) &&
    !agent && !fileHandler && !arrivalDate && !departureDate &&
    !paxAdults && !paxChildren && !quotedTotal && !currency && !terms && !exclusions &&
    !policyNotes && !amendmentNote && !passengers && !flights && !accommodations &&
    !accommodationUpdates && !flightUpdates && !flightAdds && !flightDeletes

  if (!isFlightOnlyUpdate && !isContactOnlyUpdate && !isSuperAdmin && !['DRAFT', 'CHANGE_REQUESTED', 'GT_REVIEW', 'GT_VERIFIED', 'BT_CONFIRMED', 'OPERATIONS_READY'].includes(booking.status)) {
    return buildApiError('Booking cannot be edited in current state')
  }

  const updated = await prisma.booking.update({
    where: { bookingRef: params.ref },
    data: {
      ...(agentBookingId !== undefined && { agentBookingId }),
      ...(isNumber      !== undefined && { isNumber }),
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
      ...(agentEmail !== undefined && { agentEmail }),
      ...(agentPhone !== undefined && { agentPhone }),
      ...(agentWhatsapp !== undefined && { agentWhatsapp }),
      ...(agentAddress !== undefined && { agentAddress }),
      ...(contactEmail !== undefined && { contactEmail }),
      ...(contactPhone !== undefined && { contactPhone }),
      ...(contactWhatsapp !== undefined && { contactWhatsapp }),
      ...(contactAddress !== undefined && { contactAddress }),
      ...(operationCountry !== undefined && { operationCountry }),
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

  // GT/BT/TE can update individual accommodation rooms (partial update by id)
  if (accommodationUpdates && Array.isArray(accommodationUpdates)) {
    for (const upd of accommodationUpdates as Record<string, unknown>[]) {
      if (!upd.id) continue
      await prisma.accommodation.update({
        where: { id: upd.id as string },
        data: {
          ...(upd.hotel !== undefined && { hotel: upd.hotel as string }),
          ...(upd.roomType !== undefined && { roomType: upd.roomType as string }),
          ...(upd.address !== undefined && { address: upd.address as string }),
          ...(upd.contact !== undefined && { contact: upd.contact as string }),
        },
      })
    }
  }

  // TE/BT/SUPER_ADMIN: update individual flights (reschedule, cancellation, missing flights)
  if (flightDeletes && Array.isArray(flightDeletes)) {
    for (const id of flightDeletes as string[]) {
      await prisma.flight.deleteMany({ where: { id, bookingId: booking.id } })
    }
  }

  if (flightUpdates && Array.isArray(flightUpdates)) {
    for (const upd of flightUpdates as Record<string, unknown>[]) {
      if (!upd.id) continue
      await prisma.flight.update({
        where: { id: upd.id as string },
        data: {
          ...(upd.flightNo !== undefined && { flightNo: upd.flightNo as string }),
          ...(upd.date !== undefined && { date: new Date(upd.date as string) }),
          ...(upd.fromApt !== undefined && { fromApt: upd.fromApt as string }),
          ...(upd.depTime !== undefined && { depTime: upd.depTime as string }),
          ...(upd.toApt !== undefined && { toApt: upd.toApt as string }),
          ...(upd.arrTime !== undefined && { arrTime: upd.arrTime as string }),
          ...(upd.airline !== undefined && { airline: upd.airline as string }),
          ...(upd.notes !== undefined && { notes: upd.notes as string }),
        },
      })
    }
  }

  if (flightAdds && Array.isArray(flightAdds) && flightAdds.length > 0) {
    await prisma.flight.createMany({
      data: (flightAdds as Record<string, unknown>[]).map(f => ({
        bookingId: booking.id,
        flightNo: f.flightNo as string,
        date: f.date ? new Date(f.date as string) : new Date(),
        fromApt: f.fromApt as string,
        depTime: f.depTime as string,
        toApt: f.toApt as string,
        arrTime: f.arrTime as string,
        airline: (f.airline as string) ?? null,
        notes: (f.notes as string) ?? null,
      })),
    })
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
  if (role !== 'SUPER_ADMIN' && role !== 'ULTRA_SUPER_ADMIN') return buildApiError('Only Super Admin can delete bookings', 403)

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
