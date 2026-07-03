import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

// Vendor assigns a driver + vehicle plate to their trip
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const assignment = await prisma.assignment.findFirst({
    where: { id: params.id, vendorId: session.id },
  })
  if (!assignment) return buildApiError('Not found', 404)

  const { driverId, vehiclePlate, notes } = await req.json()

  let driverName: string | null = null
  let driverPhone: string | null = null

  if (driverId) {
    const driver = await prisma.driver.findFirst({
      where: { id: driverId, vehicle: { vendorId: session.id } },
    })
    if (!driver) return buildApiError('Driver not found in your fleet')
    driverName  = driver.name
    driverPhone = driver.phone
  }

  const updated = await prisma.assignment.update({
    where: { id: params.id },
    data: {
      driverId:    driverId    || null,
      driverName:  driverName  || assignment.driverName,
      driverPhone: driverPhone || assignment.driverPhone,
      vehiclePlate: vehiclePlate?.trim() || assignment.vehiclePlate,
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
