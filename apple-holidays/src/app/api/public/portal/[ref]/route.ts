/**
 * Public customer trip portal API — no session required.
 *
 * Access is gated by the signed token (?t=…) embedded in the shareable link,
 * verified against the booking ref. Returns a client-safe view of the booking:
 * everything a traveller needs, with all cost / profit / P&L data stripped out.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { verifyPortalLinkToken } from '@/lib/portal-link'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const token = req.nextUrl.searchParams.get('t') ?? ''
  if (!verifyPortalLinkToken(params.ref, token)) {
    return buildApiError('This link is invalid or has expired.', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      passengers: { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      flights: { orderBy: { date: 'asc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      itineraryItems: { orderBy: { dayNo: 'asc' } },
      emergencyContacts: true,
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: true },
          },
        },
      },
      payments: { orderBy: { createdAt: 'desc' } },
      tickets: {
        where: { activated: true },
        orderBy: { createdAt: 'asc' },
        include: { agendaItem: { select: { date: true, location: true } } },
      },
      guestFeedback: true,
    },
  })

  if (!booking) return buildApiError('We could not find this booking.', 404)

  const portalData = {
    bookingRef: booking.bookingRef,
    status: booking.status,
    arrivalDate: booking.arrivalDate,
    departureDate: booking.departureDate,
    paxAdults: booking.paxAdults,
    paxChildren: booking.paxChildren,
    paxInfants: booking.paxInfants,
    agent: booking.agent,
    dealName: booking.dealName,
    tourDestination: booking.tourDestination,
    operationCountry: booking.operationCountry,
    languagePreference: booking.languagePreference,
    specialOccasions: booking.specialOccasions,
    importantNotes: booking.importantNotes,
    packageIncludes: booking.packageIncludes,
    packageExcludes: booking.packageExcludes,
    valueAddedServices: booking.valueAddedServices,
    tips: booking.tips,
    passengers: booking.passengers.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      isLead: p.isLead,
      nationality: p.nationality,
      mealPreference: p.mealPreference,
    })),
    flights: booking.flights,
    accommodations: booking.accommodations,
    itinerary: booking.itineraryItems,
    emergencyContacts: booking.emergencyContacts.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      role: c.role,
    })),
    agenda: booking.tourAgenda
      ? {
          items: booking.tourAgenda.items.map(item => ({
            id: item.id,
            date: item.date,
            location: item.location,
            fromPoint: item.fromPoint,
            toPoint: item.toPoint,
            details: item.details,
            mealPlan: item.mealPlan,
            meetingTime: item.meetingTime,
            timeFrom: item.timeFrom,
            timeTo: item.timeTo,
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
    // Only file-backed / purchased tickets — never cost data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tickets: (booking as any).tickets
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((t: any) => t.status === 'PURCHASED' || t.status === 'PAID' || t.fileUrl)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((t: any) => ({
        id: t.id,
        type: t.type,
        qty: t.qty,
        supplier: t.supplier,
        reference: t.reference,
        status: t.status,
        fileUrl: t.fileUrl,
        fileName: t.fileName,
        fileType: t.fileType,
        agendaItem: t.agendaItem
          ? { date: t.agendaItem.date, location: t.agendaItem.location }
          : null,
      })),
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
    feedback: booking.guestFeedback
      ? {
          purpose:            booking.guestFeedback.purpose,
          accommodationRoom:  booking.guestFeedback.accommodationRoom,
          accommodationFood:  booking.guestFeedback.accommodationFood,
          restaurantFood:     booking.guestFeedback.restaurantFood,
          restaurantAmbience: booking.guestFeedback.restaurantAmbience,
          transportVehicle:   booking.guestFeedback.transportVehicle,
          transportDriver:    booking.guestFeedback.transportDriver,
          overallExperience:  booking.guestFeedback.overallExperience,
          remarks:            booking.guestFeedback.remarks,
          clientName:         booking.guestFeedback.clientName,
          submittedAt:        booking.guestFeedback.submittedAt,
        }
      : null,
  }

  return buildApiSuccess(portalData)
}
