import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { normalisePhone } from '@/lib/whatsapp'
import {
  sendDriverAssignment,
  sendDriverCancellation,
  driverBriefState,
  type DriverMovement,
  type DriverSendResult,
} from '@/lib/driver-assignment-whatsapp'
import type { UserRole, ServiceType } from '@prisma/client'

export const dynamic = 'force-dynamic'
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
            include: {
              assignment: {
                include: {
                  driver: {
                    include: {
                      vehicle: true,
                    },
                  },
                  vendor: {
                    select: {
                      id: true,
                      name: true,
                      phone: true,
                    },
                  },
                },
              },
              tickets: true,
            },
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
    include: {
      tourAgenda: true,
      passengers: { where: { isLead: true }, take: 1 },
    },
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

  let createdItems: { id: string }[]
  try {
    createdItems = await Promise.all(
      items.map((item: Record<string, unknown>, index: number) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma.agendaItem as any).create({
          data: {
            agendaId: agenda!.id,
            date: new Date(item.date as string),
            location: item.location as string,
            fromPoint: item.fromPoint as string | undefined,
            toPoint: item.toPoint as string | undefined,
            details: item.details as string | undefined,
            mealPlan: item.mealPlan as string | undefined,
            meetingTime: item.meetingTime as string | undefined,
            timeFrom: item.timeFrom as string | undefined,
            timeTo: item.timeTo as string | undefined,
            serviceType: (item.serviceType as ServiceType) || 'OWN_ARRANGEMENT',
            isLeisure: typeof item.isLeisure === 'boolean' ? item.isLeisure : null,
            sortOrder: index,
          },
        }),
      ),
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[agenda POST] item create failed:', msg)
    // Surface a JSON error rather than throwing — an unhandled throw returns an
    // empty body, which the client's res.json() reports as "Unexpected end of
    // JSON input" and hides the real cause.
    if (/too long|1406/i.test(msg)) {
      return buildApiError(
        'One of the movement fields is too long for the database. Run the pending agenda_items TEXT migration, then save again.',
        400,
      )
    }
    return buildApiError(`Failed to save movements: ${msg}`, 500)
  }

  await Promise.all(
    items.map((item: Record<string, unknown>, index: number) => {
      // Leisure days carry no driver — the row above was recreated from scratch,
      // so simply not writing an assignment leaves it unallocated.
      if (item.isLeisure === true) return Promise.resolve()

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
        driverRate:   (assignment as any).driverRate != null ? Number((assignment as any).driverRate) : null,
        rateCurrency: (assignment as any).rateCurrency || 'USD',
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

  // ── Driver WhatsApp notifications ──────────────────────────────────────────
  // Sent on Save as well as from the Assign Driver dialog (see PUT). Both paths
  // go through driver-assignment-whatsapp.ts, so a driver is messaged once per
  // distinct allocation, is cancelled when un-assigned/replaced, and receives a
  // single consolidated message when handling several movements on one file.
  try {
    // Current drivers assigned across the saved chart, keyed by normalised phone,
    // with every movement they cover folded into one entry.
    const currentDrivers = new Map<string, {
      name: string; vehicleType: string | null; vehiclePlate: string | null
      driverRate: number | null; rateCurrency: string | null; movements: DriverMovement[]
    }>()

    for (const raw of items as Record<string, unknown>[]) {
      if (raw.isLeisure === true) continue
      const a = raw.assignment as { driverName?: string | null; driverPhone?: string | null; vehicleType?: string | null; vehiclePlate?: string | null; driverRate?: number | null; rateCurrency?: string | null } | null | undefined
      if (!a?.driverPhone || !a?.driverName) continue
      const phone = normalisePhone(a.driverPhone)
      if (!phone) continue
      const existing = currentDrivers.get(phone)
      const mv: DriverMovement = {
        date:        String(raw.date ?? ''),
        location:    String(raw.location ?? ''),
        fromPoint:   (raw.fromPoint as string) ?? null,
        toPoint:     (raw.toPoint as string) ?? null,
        details:     (raw.details as string) ?? null,
        meetingTime: (raw.meetingTime as string) ?? null,
      }
      if (existing) {
        existing.movements.push(mv)
      } else {
        currentDrivers.set(phone, {
          name:         a.driverName,
          vehicleType:  a.vehicleType ?? null,
          vehiclePlate: a.vehiclePlate ?? null,
          driverRate:   a.driverRate != null ? Number(a.driverRate) : null,
          rateCurrency: a.rateCurrency ?? 'USD',
          movements:    [mv],
        })
      }
    }

    // Last-known state per driver phone, reconstructed from the message log.
    const lastState = await driverBriefState(params.ref)

    // Assigned drivers → send the assignment template. An unchanged allocation
    // is suppressed inside the lib, so re-saving the chart doesn't re-message.
    for (const [phone, d] of Array.from(currentDrivers.entries())) {
      await sendDriverAssignment({
        bookingRef:    params.ref,
        driverName:    d.name,
        driverPhone:   phone,
        paxAdults:     booking.paxAdults,
        paxChildren:   booking.paxChildren,
        leadPassenger: booking.passengers[0]?.name ?? null,
        vehicleType:   d.vehicleType,
        vehiclePlate:  d.vehiclePlate,
        driverRate:    d.driverRate,
        rateCurrency:  d.rateCurrency,
        movements:     d.movements,
      })
    }

    // Drivers previously briefed but no longer assigned → send cancellation.
    for (const [phone, prev] of Array.from(lastState.entries())) {
      if (prev.state !== 'briefed' || currentDrivers.has(phone)) continue
      await sendDriverCancellation({ bookingRef: params.ref, driverName: prev.name, driverPhone: phone })
    }
  } catch (waErr) {
    console.error('[Agenda] Driver WhatsApp notification error (non-fatal):', waErr)
  }

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

    // Who held this movement before the change — needed to decide whether a
    // replaced driver should be told their assignment is off.
    const previous = await prisma.assignment.findUnique({
      where:  { agendaItemId: itemId },
      select: { driverName: true, driverPhone: true },
    })

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
        driverRate:   assignment.driverRate   != null ? Number(assignment.driverRate) : null,
        rateCurrency: assignment.rateCurrency || 'USD',
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

    // ── Driver WhatsApp notification ─────────────────────────────────────────
    // Assigning a driver from the dialog messages them straight away with the
    // booking details, via an approved template (a driver who has never written
    // to the ops number is outside WhatsApp's 24h window, where free-form text
    // is silently dropped). Non-fatal: a send failure never blocks the save.
    let whatsapp: DriverSendResult | null = null
    try {
      const newPhone = assignment === null ? '' : normalisePhone(assignment.driverPhone ?? '')
      const oldPhone = normalisePhone(previous?.driverPhone ?? '')

      if (newPhone) {
        const booking = await prisma.booking.findUnique({
          where:  { bookingRef: params.ref },
          select: {
            paxAdults: true,
            paxChildren: true,
            passengers: { where: { isLead: true }, take: 1, select: { name: true } },
          },
        })
        whatsapp = await sendDriverAssignment({
          bookingRef:    params.ref,
          driverName:    assignment.driverName ?? '',
          driverPhone:   newPhone,
          paxAdults:     booking?.paxAdults ?? 0,
          paxChildren:   booking?.paxChildren ?? 0,
          leadPassenger: booking?.passengers[0]?.name ?? null,
          vehicleType:   assignment.vehicleType  ?? null,
          vehiclePlate:  assignment.vehiclePlate ?? null,
          driverRate:    assignment.driverRate != null ? Number(assignment.driverRate) : null,
          rateCurrency:  assignment.rateCurrency ?? 'USD',
          movements: [{
            date:        agendaItem.date,
            location:    agendaItem.location,
            fromPoint:   agendaItem.fromPoint,
            toPoint:     agendaItem.toPoint,
            details:     agendaItem.details,
            meetingTime: agendaItem.meetingTime,
          }],
        })
      }

      // A driver dropped or replaced on this movement is told only once they
      // hold no other movement on the booking — they may still be driving it.
      if (oldPhone && oldPhone !== newPhone) {
        const remaining = await prisma.assignment.findMany({
          where:  { agendaItem: { agenda: { booking: { bookingRef: params.ref } } } },
          select: { driverPhone: true },
        })
        const stillAssigned = remaining.some(r => normalisePhone(r.driverPhone ?? '') === oldPhone)
        if (!stillAssigned) {
          await sendDriverCancellation({
            bookingRef:  params.ref,
            driverName:  previous?.driverName ?? 'Driver',
            driverPhone: oldPhone,
          })
        }
      }
    } catch (waErr) {
      console.error('[Agenda PUT] Driver WhatsApp notification error (non-fatal):', waErr)
    }

    const updated = await prisma.agendaItem.findUnique({
      where: { id: itemId },
      include: {
        assignment: {
          include: {
            driver: {
              include: {
                vehicle: true,
              },
            },
            vendor: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        },
      },
    })
    // The toast reports whether the driver was actually messaged, so staff never
    // assume a notification went out when the template send was skipped/failed.
    const waNote =
      !whatsapp                        ? ''
      : whatsapp.ok                    ? ' — WhatsApp sent to driver'
      : whatsapp.reason === 'duplicate' ? ' — driver already notified of these details'
      : whatsapp.reason === 'disabled'  ? ' — driver WhatsApp is switched off'
      : whatsapp.reason === 'no-phone'  ? ' — no driver phone number, WhatsApp not sent'
      : ' — WhatsApp to driver failed'

    return buildApiSuccess(
      { ...updated, whatsapp },
      `Assignment saved${waNote}`,
    )
  }

  // Marking a movement as a leisure day also releases any driver already
  // allocated to it — a free day must never hold a vehicle booking.
  if (body.isLeisure === true) {
    await prisma.assignment.deleteMany({ where: { agendaItemId: itemId } })
  }

  const updated = await prisma.agendaItem.update({
    where: { id: itemId },
    data: {
      ...(body.isLeisure !== undefined && { isLeisure: body.isLeisure }),
      ...(body.date && { date: new Date(body.date) }),
      ...(body.location !== undefined && { location: body.location }),
      ...(body.fromPoint !== undefined && { fromPoint: body.fromPoint }),
      ...(body.toPoint !== undefined && { toPoint: body.toPoint }),
      ...(body.details !== undefined && { details: body.details }),
      ...(body.mealPlan !== undefined && { mealPlan: body.mealPlan }),
      ...(body.meetingTime !== undefined && { meetingTime: body.meetingTime }),
      ...(body.serviceType && { serviceType: body.serviceType }),
    },
    include: {
      assignment: {
        include: {
          driver: {
            include: {
              vehicle: true,
            },
          },
          vendor: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
      },
    },
  })

  return buildApiSuccess(updated, 'Agenda item updated')
}
