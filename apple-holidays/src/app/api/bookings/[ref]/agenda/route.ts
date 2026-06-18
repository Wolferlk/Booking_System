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

  await Promise.all(
    items.map((item: Record<string, unknown>, index: number) => {
      const assignment = item.assignment as
        | {
            driverId?: string | null
            vendorId?: string | null
            vendorName?: string | null
            driverName?: string | null
            driverPhone?: string | null
            vehicleType?: string | null
            vehiclePlate?: string | null
            notes?: string | null
          }
        | null
        | undefined

      if (!assignment) return Promise.resolve()

      // Skip if nothing meaningful is set
      const hasData = assignment.driverId || assignment.vendorId || assignment.vendorName || assignment.driverName
      if (!hasData) return Promise.resolve()

      const agendaItem = createdItems[index]
      if (!agendaItem) return Promise.resolve()

      const data = {
        driverId:     assignment.driverId     || null,
        vendorId:     assignment.vendorId     || null,
        vendorName:   assignment.vendorName   || null,
        driverName:   assignment.driverName   || null,
        driverPhone:  assignment.driverPhone  || null,
        vehicleType:  assignment.vehicleType  || null,
        vehiclePlate: assignment.vehiclePlate || null,
        notes:        assignment.notes        || null,
      }

      return prisma.assignment.upsert({
        where: { agendaItemId: agendaItem.id },
        create: { agendaItemId: agendaItem.id, ...data },
        update: data,
      }).catch((err: Error) => {
        console.error('[agenda POST] assignment upsert failed:', err.message, { agendaItemId: agendaItem.id, vendorId: data.vendorId, driverId: data.driverId })
        // Non-fatal: skip assignment rather than failing the whole save
      })
    }),
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
      const data = {
        driverId:     assignment.driverId     || null,
        vendorId:     assignment.vendorId     || null,
        vendorName:   assignment.vendorName   || null,
        driverName:   assignment.driverName   || null,
        driverPhone:  assignment.driverPhone  || null,
        vehicleType:  assignment.vehicleType  || null,
        vehiclePlate: assignment.vehiclePlate || null,
        notes:        assignment.notes        || null,
      }
      try {
        await prisma.assignment.upsert({
          where: { agendaItemId: itemId },
          create: { agendaItemId: itemId, ...data },
          update: data,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[agenda PUT] assignment upsert failed:', msg)
        return buildApiError(`Assignment save failed: ${msg}`, 500)
      }
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
