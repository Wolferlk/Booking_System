import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole, ServiceType } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: true, tickets: true },
          },
        },
      },
    },
  })

  if (!booking) return buildApiError('Booking not found', 404)

  return buildApiSuccess(booking.tourAgenda)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'agenda:create')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: { tourAgenda: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const { items = [] } = await req.json()

  let agenda = booking.tourAgenda

  if (agenda) {
    // Clear and recreate items
    await prisma.agendaItem.deleteMany({ where: { agendaId: agenda.id } })
    agenda = await prisma.tourAgenda.update({
      where: { id: agenda.id },
      data: { updatedAt: new Date() },
    })
  } else {
    agenda = await prisma.tourAgenda.create({
      data: { bookingId: booking.id },
    })
  }

  const createdItems = await Promise.all(
    items.map((item: Record<string, unknown>, index: number) =>
      prisma.agendaItem.create({
        data: {
          agendaId: agenda!.id,
          date: new Date(item.date as string),
          location: item.location as string,
          fromPoint: item.fromPoint as string | undefined,
          toPoint: item.toPoint as string | undefined,
          details: item.details as string | undefined,
          mealPlan: item.mealPlan as string | undefined,
          meetingTime: item.meetingTime as string | undefined,
          serviceType: (item.serviceType as ServiceType) || 'OWN_ARRANGEMENT',
          sortOrder: index,
        },
      }),
    ),
  )

  return buildApiSuccess({ agenda, items: createdItems }, 'Agenda saved')
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'agenda:edit')) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json()
  const { itemId, assignment } = body

  if (!itemId) return buildApiError('itemId is required')

  // If assignment provided, upsert it
  if (assignment !== undefined) {
    const agendaItem = await prisma.agendaItem.findUnique({ where: { id: itemId } })
    if (!agendaItem) return buildApiError('Agenda item not found', 404)

    if (assignment === null) {
      await prisma.assignment.deleteMany({ where: { agendaItemId: itemId } })
    } else {
      await prisma.assignment.upsert({
        where: { agendaItemId: itemId },
        create: {
          agendaItemId: itemId,
          driverId: assignment.driverId || null,
          driverName: assignment.driverName || null,
          driverPhone: assignment.driverPhone || null,
          vehicleType: assignment.vehicleType || null,
          vehiclePlate: assignment.vehiclePlate || null,
          notes: assignment.notes || null,
        },
        update: {
          driverId: assignment.driverId || null,
          driverName: assignment.driverName || null,
          driverPhone: assignment.driverPhone || null,
          vehicleType: assignment.vehicleType || null,
          vehiclePlate: assignment.vehiclePlate || null,
          notes: assignment.notes || null,
        },
      })
    }
    const updated = await prisma.agendaItem.findUnique({ where: { id: itemId }, include: { assignment: true } })
    return buildApiSuccess(updated, 'Assignment saved')
  }

  const updated = await prisma.agendaItem.update({
    where: { id: itemId },
    data: {
      ...(body.date && { date: new Date(body.date) }),
      ...(body.location !== undefined && { location: body.location }),
      ...(body.fromPoint !== undefined && { fromPoint: body.fromPoint }),
      ...(body.toPoint !== undefined && { toPoint: body.toPoint }),
      ...(body.details !== undefined && { details: body.details }),
      ...(body.mealPlan !== undefined && { mealPlan: body.mealPlan }),
      ...(body.meetingTime !== undefined && { meetingTime: body.meetingTime }),
      ...(body.serviceType && { serviceType: body.serviceType }),
    },
    include: { assignment: true },
  })

  return buildApiSuccess(updated, 'Agenda item updated')
}
