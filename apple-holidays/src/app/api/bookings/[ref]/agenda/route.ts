import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { sendWhatsAppText, formatDriverBriefingMessage, formatDriverCancellationMessage, normalisePhone } from '@/lib/whatsapp'
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
  // Notifications are sent here (on Save) rather than on individual driver
  // selection. Logic is idempotent against the durable WhatsApp message log so a
  // driver is briefed only once per booking, is cancelled when un-assigned/replaced,
  // and receives a single consolidated message when handling several movements.
  try {
    const DRIVER_TAG = '[DRIVER]'
    const CANCEL_TAG = '[DRIVER-CANCEL]'

    // Current drivers assigned across the saved chart, keyed by normalised phone,
    // with every movement they cover folded into one entry.
    type Mv = { date: string; location: string; fromPoint: string | null; toPoint: string | null; details: string | null; meetingTime: string | null }
    const currentDrivers = new Map<string, {
      name: string; vehicleType: string | null; vehiclePlate: string | null
      driverRate: number | null; rateCurrency: string | null; movements: Mv[]
    }>()

    for (const raw of items as Record<string, unknown>[]) {
      const a = raw.assignment as { driverName?: string | null; driverPhone?: string | null; vehicleType?: string | null; vehiclePlate?: string | null; driverRate?: number | null; rateCurrency?: string | null } | null | undefined
      if (!a?.driverPhone || !a?.driverName) continue
      const phone = normalisePhone(a.driverPhone)
      if (!phone) continue
      const existing = currentDrivers.get(phone)
      const mv: Mv = {
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

    // Reconstruct the last-known state per driver phone from the message log.
    const driverLogs = await prisma.whatsAppMessage.findMany({
      where: { bookingRef: params.ref, direction: 'outbound', senderName: { startsWith: '[DRIVER' } },
      orderBy: { createdAt: 'asc' },
      select: { phone: true, senderName: true },
    })
    const lastState = new Map<string, 'briefed' | 'cancelled'>()
    const lastName  = new Map<string, string>()
    for (const m of driverLogs) {
      const p = normalisePhone(m.phone)
      const isCancel = m.senderName?.startsWith(CANCEL_TAG)
      lastState.set(p, isCancel ? 'cancelled' : 'briefed')
      const nm = m.senderName?.replace(CANCEL_TAG, '').replace(DRIVER_TAG, '').trim()
      if (nm) lastName.set(p, nm)
    }

    // Newly-assigned drivers (not currently in a briefed state) → send consolidated briefing.
    for (const [phone, d] of Array.from(currentDrivers.entries())) {
      if (lastState.get(phone) === 'briefed') continue
      const msg = formatDriverBriefingMessage({
        driverName:    d.name,
        bookingRef:    params.ref,
        paxAdults:     booking.paxAdults,
        paxChildren:   booking.paxChildren,
        leadPassenger: booking.passengers[0]?.name ?? null,
        vehicleType:   d.vehicleType,
        vehiclePlate:  d.vehiclePlate,
        driverRate:    d.driverRate,
        rateCurrency:  d.rateCurrency,
        movements:     d.movements,
      })
      const sent = await sendWhatsAppText(phone, msg, d.name)
      if (sent) {
        await prisma.whatsAppMessage.create({
          data: { bookingRef: params.ref, phone, direction: 'outbound', body: msg, status: 'sent', senderName: `${DRIVER_TAG} ${d.name}` },
        })
        console.log(`[Agenda] Driver briefing sent to ${d.name} (${phone}) for ${params.ref} — ${d.movements.length} movement(s)`)
      }
    }

    // Drivers previously briefed but no longer assigned → send cancellation.
    for (const [phone, state] of Array.from(lastState.entries())) {
      if (state !== 'briefed' || currentDrivers.has(phone)) continue
      const name = lastName.get(phone) ?? 'Driver'
      const msg  = formatDriverCancellationMessage({ driverName: name, bookingRef: params.ref })
      const sent = await sendWhatsAppText(phone, msg, name)
      if (sent) {
        await prisma.whatsAppMessage.create({
          data: { bookingRef: params.ref, phone, direction: 'outbound', body: msg, status: 'sent', senderName: `${CANCEL_TAG} ${name}` },
        })
        console.log(`[Agenda] Driver cancellation sent to ${name} (${phone}) for ${params.ref}`)
      }
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

      // NOTE: Driver WhatsApp notifications are intentionally NOT sent here.
      // They are sent from the POST (whole-chart "Save") handler so messages fire
      // on Save — not on individual driver selection — and can be de-duplicated /
      // consolidated / cancelled across the full set of assignments.
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
