import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'
import { detectCountryFromRef } from '@/lib/country-detection'

export const dynamic = 'force-dynamic'

// Sri Lanka works one-tour-one-driver: assigning on any movement applies to the whole
// booking. Every other country (SG / MY / VN) allocates per movement.
function isWholeBookingCountry(
  operationCountry: string | null,
  bookingRef: string,
): boolean {
  const country = operationCountry ?? detectCountryFromRef(bookingRef)
  return country === 'SRILANKA'
}

// Vendor assigns a driver + vehicle — to this movement only, or to every movement of
// the booking when the booking is a Sri Lanka tour.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  // Find the target assignment (verify vendor owns it)
  const assignment = await prisma.assignment.findFirst({
    where: { id: params.id, vendorId: session.id },
    include: { agendaItem: { include: { agenda: { include: { booking: {
      select: { bookingRef: true, operationCountry: true },
    } } } } } },
  })
  if (!assignment) return buildApiError('Not found', 404)

  const { driverId, vehicleId, notes } = await req.json()

  let driverName:  string | null = null
  let driverPhone: string | null = null

  if (driverId) {
    const driver = await prisma.driver.findFirst({
      where: { id: driverId, vendorId: session.id },
    })
    if (!driver) return buildApiError('Driver not found in your fleet')
    driverName  = driver.name
    driverPhone = driver.phone
  }

  let vehiclePlate: string | null = assignment.vehiclePlate
  let vehicleType:  string | null = assignment.vehicleType

  if (vehicleId !== undefined) {
    if (vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: vehicleId, vendorId: session.id },
      })
      if (!vehicle) return buildApiError('Vehicle not found in your fleet')
      vehiclePlate = vehicle.plateNo
      vehicleType  = vehicle.type
    } else {
      vehiclePlate = null
      vehicleType  = null
    }
  }

  const bookingId = assignment.agendaItem.agenda.bookingId
  const booking   = assignment.agendaItem.agenda.booking
  const wholeBooking = isWholeBookingCountry(booking.operationCountry, booking.bookingRef)

  await prisma.assignment.updateMany({
    where: wholeBooking
      // Sri Lanka — every movement of this booking owned by this vendor
      ? { vendorId: session.id, agendaItem: { agenda: { bookingId } } }
      // SG / MY / VN — this movement only
      : { id: assignment.id, vendorId: session.id },
    data: {
      driverId:    driverId  !== undefined ? (driverId  || null) : assignment.driverId,
      driverName:  driverName  ?? (driverId  === null ? null : assignment.driverName),
      driverPhone: driverPhone ?? (driverId  === null ? null : assignment.driverPhone),
      vehiclePlate,
      vehicleType,
      notes: notes ?? assignment.notes,
    },
  })

  // Return the updated record(s) with full relations for the UI
  const updated = await prisma.assignment.findMany({
    where: wholeBooking
      ? { vendorId: session.id, agendaItem: { agenda: { bookingId } } }
      : { id: assignment.id },
    orderBy: { agendaItem: { date: 'asc' } },
    include: {
      agendaItem: {
        include: {
          agenda: {
            include: {
              booking: {
                select: {
                  bookingRef: true, isNumber: true, dealName: true,
                  paxAdults: true, paxChildren: true, operationCountry: true,
                },
              },
            },
          },
        },
      },
      driver: { select: { id: true, name: true, phone: true, photoUrl: true } },
    },
  })

  return buildApiSuccess(
    { assignments: updated, bookingId, wholeBooking },
    wholeBooking ? 'All movements updated' : 'Movement updated',
  )
}
