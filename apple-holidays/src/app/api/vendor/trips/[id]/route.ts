import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

// Vendor assigns a driver + vehicle to their trip (independently selectable)
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const assignment = await prisma.assignment.findFirst({
    where: { id: params.id, vendorId: session.id },
  })
  if (!assignment) return buildApiError('Not found', 404)

  const { driverId, vehicleId, notes } = await req.json()

  let driverName: string | null = null
  let driverPhone: string | null = null

  if (driverId) {
    const driver = await prisma.driver.findFirst({
      where: { id: driverId, vendorId: session.id },
    })
    if (!driver) return buildApiError('Driver not found in your fleet')
    driverName  = driver.name
    driverPhone = driver.phone
  }

  // Resolve vehicle plate from vehicleId
  let vehiclePlate: string | null = assignment.vehiclePlate
  let vehicleType: string | null  = assignment.vehicleType
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

  const updated = await prisma.assignment.update({
    where: { id: params.id },
    data: {
      driverId:    driverId !== undefined ? (driverId || null) : assignment.driverId,
      driverName:  driverName  ?? (driverId === null ? null : assignment.driverName),
      driverPhone: driverPhone ?? (driverId === null ? null : assignment.driverPhone),
      vehiclePlate,
      vehicleType,
      notes: notes ?? assignment.notes,
    },
    include: {
      agendaItem: {
        include: {
          agenda: {
            include: { booking: { select: { bookingRef: true, dealName: true } } },
          },
        },
      },
      driver: { select: { id: true, name: true, phone: true } },
    },
  })

  return buildApiSuccess(updated, 'Assignment updated')
}
