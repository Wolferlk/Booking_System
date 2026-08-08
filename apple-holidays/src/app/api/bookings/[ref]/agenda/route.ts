import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { normalisePhone } from '@/lib/whatsapp'
import { syncSlAllocationFromAgenda, syncSlAllocationFromAgendaByRef } from '@/lib/sl-driver-allocation-sync'
import {
  sendDriverAssignment,
  sendDriverCancellation,
  driverBriefState,
  type DriverMovement,
  type DriverSendResult,
} from '@/lib/driver-assignment-whatsapp'
import { upsertManualPartner } from '@/lib/partner-directory-server'
import type { UserRole, ServiceType } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Everyone running a movement: driver + vehicle, vehicle vendor, guide and
 * tour vendor. Shared by all three reads in this file so the movement chart
 * never receives a half-populated assignment depending on which one answered.
 */
const ASSIGNMENT_INCLUDE = {
  driver: { include: { vehicle: true } },
  vendor: { select: { id: true, name: true, phone: true } },
  guide: {
    select: { id: true, name: true, phone: true, whatsappPhone: true, photoUrl: true, languages: true },
  },
  tourVendor: {
    select: { id: true, name: true, phone: true, whatsappPhone: true, photoUrl: true, services: true },
  },
} as const

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
              assignment: { include: ASSIGNMENT_INCLUDE },
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
            guideId?: string | null
            guideName?: string | null
            guidePhone?: string | null
            tourVendorId?: string | null
            tourVendorName?: string | null
            tourVendorPhone?: string | null
          }
        | null
        | undefined

      if (!assignment) return Promise.resolve()

      // Skip if nothing meaningful is set. A movement with only a guide or only
      // a tour vendor counts — otherwise saving the chart would drop them, since
      // the rows above were recreated from scratch.
      const hasData = assignment.driverId || assignment.vendorId || assignment.vendorName
        || assignment.driverName || assignment.guideName || assignment.tourVendorName
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
        guideId:         assignment.guideId         || null,
        guideName:       assignment.guideName       || null,
        guidePhone:      assignment.guidePhone      || null,
        tourVendorId:    assignment.tourVendorId    || null,
        tourVendorName:  assignment.tourVendorName  || null,
        tourVendorPhone: assignment.tourVendorPhone || null,
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

  // Drivers set on the chart must also show on the Sri Lanka Driver Allocation
  // board, which reads the booking-level allocation row. Non-fatal.
  try {
    await syncSlAllocationFromAgenda(booking.id)
  } catch (syncErr) {
    console.error('[Agenda POST] SL allocation sync failed (non-fatal):', syncErr)
  }

  // ── Driver WhatsApp notifications ──────────────────────────────────────────
  // Sent on Save as well as from the Assign Driver dialog (see PUT). Both paths
  // go through driver-assignment-whatsapp.ts, so a driver is messaged once per
  // distinct allocation, is cancelled when un-assigned/replaced, and receives a
  // single consolidated message when handling several movements on one file.
  try {
    // Current drivers assigned across the saved chart, keyed by normalised phone,
    // with every movement they cover folded into one entry.
    // The agreed rate is not collected here — it is never sent to the driver.
    const currentDrivers = new Map<string, {
      name: string; vehicleType: string | null; vehiclePlate: string | null
      movements: DriverMovement[]
    }>()

    for (const raw of items as Record<string, unknown>[]) {
      if (raw.isLeisure === true) continue
      const a = raw.assignment as { driverName?: string | null; driverPhone?: string | null; vehicleType?: string | null; vehiclePlate?: string | null } | null | undefined
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
      // A guide or tour vendor typed by hand — rather than picked from the
      // directory — is saved into the directory here, so the next booking can
      // select them instead of retyping. Non-fatal: a failure to file them away
      // must never block the movement from being assigned.
      let guideId      = assignment.guideId      || null
      let tourVendorId = assignment.tourVendorId || null
      try {
        const partnerCountry = await prisma.booking.findUnique({
          where:  { bookingRef: params.ref },
          select: { operationCountry: true },
        })
        if (!guideId && assignment.guideName?.trim()) {
          guideId = await upsertManualPartner('guide', {
            name:    assignment.guideName,
            phone:   assignment.guidePhone,
            country: partnerCountry?.operationCountry ?? null,
          })
        }
        if (!tourVendorId && assignment.tourVendorName?.trim()) {
          tourVendorId = await upsertManualPartner('tourVendor', {
            name:    assignment.tourVendorName,
            phone:   assignment.tourVendorPhone,
            country: partnerCountry?.operationCountry ?? null,
          })
        }
      } catch (partnerErr) {
        console.error('[Agenda PUT] Saving ad-hoc guide/tour vendor failed (non-fatal):', partnerErr)
      }

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
        guideId,
        guideName:       assignment.guideName?.trim()       || null,
        guidePhone:      assignment.guidePhone?.trim()      || null,
        tourVendorId,
        tourVendorName:  assignment.tourVendorName?.trim()  || null,
        tourVendorPhone: assignment.tourVendorPhone?.trim() || null,
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

    // Keep the SL Driver Allocation board in step with the chart. Non-fatal.
    try {
      await syncSlAllocationFromAgendaByRef(params.ref)
    } catch (syncErr) {
      console.error('[Agenda PUT] SL allocation sync failed (non-fatal):', syncErr)
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

      // Attempted whenever a driver was named, even without a number — the lib
      // reports 'no-phone' back so the toast can say the driver wasn't reached
      // rather than leaving staff to assume the message went out.
      if (assignment !== null && (assignment.driverName || newPhone)) {
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
      include: { assignment: { include: ASSIGNMENT_INCLUDE } },
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
    include: { assignment: { include: ASSIGNMENT_INCLUDE } },
  })

  return buildApiSuccess(updated, 'Agenda item updated')
}
