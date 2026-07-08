import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

// Vendor assigns a driver + vehicle — applied to ALL movements of the same booking
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  // Find the target assignment (verify vendor owns it)
  const assignment = await prisma.assignment.findFirst({
    where: { id: params.id, vendorId: session.id },
    include: { agendaItem: { include: { agenda: true } } },
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

  // Update ALL assignments for this booking that belong to this vendor
  await prisma.assignment.updateMany({
    where: {
      vendorId: session.id,
      agendaItem: { agenda: { bookingId } },
    },
    data: {
      driverId:    driverId  !== undefined ? (driverId  || null) : assignment.driverId,
      driverName:  driverName  ?? (driverId  === null ? null : assignment.driverName),
      driverPhone: driverPhone ?? (driverId  === null ? null : assignment.driverPhone),
      vehiclePlate,
      vehicleType,
      notes: notes ?? assignment.notes,
    },
  })

  // Return one updated record with full relations for the UI
  const updated = await prisma.assignment.findFirst({
    where: { vendorId: session.id, agendaItem: { agenda: { bookingId } } },
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

  return buildApiSuccess({ ...updated, bookingId }, 'All movements updated')
}
