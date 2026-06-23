/**
 * Full Booking API — /api/bookings/full/[ref]
 *
 * GET  /api/bookings/full/464660  → complete booking snapshot
 * PUT  /api/bookings/full/464660  → update any section (core / passengers / flights /
 *                                    accommodations / agenda / drivers / pnl)
 * POST /api/bookings/full/[ref]   → create a new booking with all nested data
 *                                   (ref in body takes precedence over URL param)
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import { canSeeAllCountries } from '@/lib/rbac'
import { detectCountryFromRef, isInCountryScope } from '@/lib/country-detection'
import type { OperationCountry } from '@/lib/country-detection'

// ─── Full booking include ────────────────────────────────────────────────────

const FULL_INCLUDE = {
  createdBy:        { select: { id: true, name: true, email: true, role: true } },
  passengers:       { orderBy: { name: 'asc' as const } },
  emergencyContacts: true,
  flights:          { orderBy: { date: 'asc' as const } },
  accommodations:   { orderBy: { checkIn: 'asc' as const } },
  itineraryItems:   { orderBy: { dayNo: 'asc' as const } },
  tourAgenda: {
    include: {
      items: {
        orderBy: [{ date: 'asc' as const }, { sortOrder: 'asc' as const }],
        include: {
          assignment: {
            include: {
              driver: {
                include: {
                  vehicle: true,
                },
              },
            },
          },
          tickets: true,
        },
      },
    },
  },
  pnl: {
    include: {
      lineItems: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  payments:      { orderBy: { createdAt: 'desc' as const } },
  tickets:       { orderBy: { createdAt: 'desc' as const } },
  changeRequests: {
    include: { raisedBy: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  statusEvents: {
    include: { actor: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const ref = params.ref.trim()
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  // Accept numeric-only refs: "464660" finds "464660" directly
  let booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    include: FULL_INCLUDE,
  })

  // Fallback: try numeric prefix/suffix match (e.g. "464660" ↔ "464660CNTL")
  if (!booking) {
    const numeric = ref.replace(/[^0-9]/g, '')
    if (numeric.length >= 4) {
      booking = await prisma.booking.findFirst({
        where: { bookingRef: { startsWith: numeric } },
        include: FULL_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }) ?? await prisma.booking.findFirst({
        where: { bookingRef: { endsWith: numeric } },
        include: FULL_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }) ?? null
    }
  }

  if (!booking) return buildApiError(`Booking "${ref}" not found`, 404)

  const role = session.user.role
  const userCountry = session.user.country as OperationCountry | undefined
  if (!canSeeAllCountries(role as any, userCountry ?? 'ALL') && userCountry && !isInCountryScope(booking.operationCountry, userCountry)) {
    return buildApiError('Forbidden', 403)
  }

  return buildApiSuccess(shapeBooking(booking))
}

// ─── POST — create new booking with all nested data ──────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json() as BookingInput
  const bookingRef = (body.bookingRef ?? params.ref).trim().toUpperCase()

  if (!bookingRef) return buildApiError('bookingRef is required')
  if (!body.arrivalDate || !body.departureDate) {
    return buildApiError('arrivalDate and departureDate are required')
  }

  const exists = await prisma.booking.findUnique({ where: { bookingRef } })
  if (exists) return buildApiError(`Booking "${bookingRef}" already exists — use PUT to update`, 409)

  const detectedCountry = detectCountryFromRef(bookingRef)
  const sessionCountry = session.user.country as OperationCountry | undefined
  const operationCountry = detectedCountry ?? (sessionCountry && sessionCountry !== 'ALL' ? sessionCountry : null)
  if (!operationCountry) {
    return buildApiError('Booking country could not be determined from bookingRef')
  }
  if (sessionCountry && sessionCountry !== 'ALL' && !isInCountryScope(operationCountry, sessionCountry)) {
    return buildApiError('Forbidden — booking country must match your assigned country', 403)
  }

  const booking = await prisma.booking.create({
    data: {
      bookingRef,
      agentBookingId:  body.agentBookingId ?? null,
      agent:           body.agent ?? 'Unknown Agent',
      fileHandler:     body.fileHandler ?? null,
      arrivalDate:     new Date(body.arrivalDate),
      departureDate:   new Date(body.departureDate),
      paxAdults:       body.paxAdults ?? 2,
      paxChildren:     body.paxChildren ?? 0,
      quotedTotal:     body.quotedTotal ?? null,
      currency:        body.currency ?? 'USD',
      terms:           body.terms ?? null,
      exclusions:      body.exclusions ?? null,
      agentEmail:      body.agentEmail ?? null,
      agentPhone:      body.agentPhone ?? null,
      agentWhatsapp:   body.agentWhatsapp ?? null,
      agentCountry:    body.agentCountry ?? null,
      agentAddress:    body.agentAddress ?? null,
      contactEmail:    body.contactEmail ?? null,
      contactPhone:    body.contactPhone ?? null,
      contactWhatsapp: body.contactWhatsapp ?? null,
      contactCountry:  body.contactCountry ?? null,
      contactAddress:  body.contactAddress ?? null,
      operationCountry,
      status:          (body.status as never) ?? 'GT_REVIEW',
      createdById:     session.user.id,
    },
  })

  await createNestedData(booking.id, body, booking.currency ?? 'USD')

  await logActivity({
    userId:     session.user.id,
    action:     ACTION.BOOKING_CREATED,
    entityType: 'Booking',
    entityId:   booking.id,
    details:    { source: 'api', bookingRef },
  })

  const full = await prisma.booking.findUnique({ where: { id: booking.id }, include: FULL_INCLUDE })
  return buildApiSuccess(shapeBooking(full), `Booking ${bookingRef} created`)
}

// ─── PUT — update any section ─────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const ref = params.ref.trim()
  const booking = await prisma.booking.findUnique({ where: { bookingRef: ref } })
  if (!booking) return buildApiError(`Booking "${ref}" not found`, 404)

  const role = session.user.role
  const userCountry = session.user.country as OperationCountry | undefined
  if (!canSeeAllCountries(role as any, userCountry ?? 'ALL') && userCountry && !isInCountryScope(booking.operationCountry, userCountry)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json() as Partial<BookingInput>

  // ── Core fields ──────────────────────────────────────────────────────────
  const coreUpdate: Record<string, unknown> = {}
  const coreFields: (keyof BookingInput)[] = [
    'agent','fileHandler','agentBookingId','arrivalDate','departureDate',
    'paxAdults','paxChildren','quotedTotal','currency','terms','exclusions',
    'agentEmail','agentPhone','agentWhatsapp','agentCountry','agentAddress',
    'contactEmail','contactPhone','contactWhatsapp','contactCountry','contactAddress',
    'status','policyNotes','amendmentNote',
  ]
  for (const f of coreFields) {
    if (f in body) {
      if (f === 'arrivalDate' || f === 'departureDate') {
        coreUpdate[f] = new Date(body[f] as string)
      } else {
        coreUpdate[f] = body[f]
      }
    }
  }
  if (Object.keys(coreUpdate).length > 0) {
    await prisma.booking.update({ where: { id: booking.id }, data: coreUpdate })
  }

  // ── Passengers — full replace when provided ───────────────────────────────
  if (Array.isArray(body.passengers)) {
    await prisma.passenger.deleteMany({ where: { bookingId: booking.id } })
    if (body.passengers.length > 0) {
      await prisma.passenger.createMany({
        data: body.passengers.map(p => ({
          bookingId:   booking.id,
          name:        p.name,
          type:        (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD',
          isLead:      p.isLead ?? false,
          age:         p.age ?? null,
          passport:    p.passport ?? null,
          nationality: p.nationality ?? null,
          contact:     p.contact ?? null,
        })),
      })
    }
  }

  // ── Emergency contacts — full replace when provided ───────────────────────
  if (Array.isArray(body.emergencyContacts)) {
    await prisma.emergencyContact.deleteMany({ where: { bookingId: booking.id } })
    if (body.emergencyContacts.length > 0) {
      await prisma.emergencyContact.createMany({
        data: body.emergencyContacts.map(c => ({
          bookingId: booking.id,
          name:      c.name,
          phone:     c.phone ?? null,
          role:      c.role ?? null,
        })),
      })
    }
  }

  // ── Flights — full replace when provided ─────────────────────────────────
  if (Array.isArray(body.flights)) {
    await prisma.flight.deleteMany({ where: { bookingId: booking.id } })
    if (body.flights.length > 0) {
      await prisma.flight.createMany({
        data: body.flights.map(f => ({
          bookingId: booking.id,
          flightNo:  f.flightNo,
          date:      new Date(f.date),
          fromApt:   f.fromApt,
          depTime:   f.depTime ?? '',
          toApt:     f.toApt,
          arrTime:   f.arrTime ?? '',
          airline:   f.airline ?? null,
          notes:     f.notes ?? null,
        })),
      })
    }
  }

  // ── Accommodations — full replace when provided ───────────────────────────
  if (Array.isArray(body.accommodations)) {
    await prisma.accommodation.deleteMany({ where: { bookingId: booking.id } })
    if (body.accommodations.length > 0) {
      await prisma.accommodation.createMany({
        data: body.accommodations.map(a => ({
          bookingId: booking.id,
          hotel:     a.hotel,
          city:      a.city,
          checkIn:   new Date(a.checkIn),
          checkOut:  new Date(a.checkOut),
          nights:    a.nights,
          roomType:  a.roomType ?? null,
          mealType:  a.mealType ?? null,
          address:   a.address ?? null,
          contact:   a.contact ?? null,
        })),
      })
    }
  }

  // ── Agenda items — patch individual items or replace all ──────────────────
  if (Array.isArray(body.agendaItems)) {
    let agenda = await prisma.tourAgenda.findUnique({ where: { bookingId: booking.id } })
    if (!agenda) {
      agenda = await prisma.tourAgenda.create({ data: { bookingId: booking.id } })
    }
    await prisma.agendaItem.deleteMany({ where: { agendaId: agenda.id } })

    for (let i = 0; i < body.agendaItems.length; i++) {
      const item = body.agendaItems[i]
      const created = await prisma.agendaItem.create({
        data: {
          agendaId:    agenda.id,
          date:        new Date(item.date),
          location:    item.location,
          fromPoint:   item.fromPoint ?? null,
          toPoint:     item.toPoint ?? null,
          details:     item.details ?? null,
          mealPlan:    item.mealPlan ?? null,
          meetingTime: item.meetingTime ?? null,
          serviceType: (item.serviceType ?? 'OWN_ARRANGEMENT') as never,
          sortOrder:   i,
        },
      })

      // Driver assignment for this agenda item
      if (item.assignment) {
        const asgn = item.assignment
        await prisma.assignment.create({
          data: {
            agendaItemId: created.id,
            driverId:     asgn.driverId ?? null,
            driverName:   asgn.driverName ?? null,
            driverPhone:  asgn.driverPhone ?? null,
            vehicleType:  asgn.vehicleType ?? null,
            vehiclePlate: asgn.vehiclePlate ?? null,
            notes:        asgn.notes ?? null,
          },
        })
      }
    }
  }

  // ── Driver assignment patch — update a single agenda item's assignment ────
  // body.assignDriver = { agendaItemId, driverId, driverName, driverPhone, vehicleType, vehiclePlate, notes }
  if (body.assignDriver) {
    const { agendaItemId, ...assignData } = body.assignDriver
    await prisma.assignment.upsert({
      where:  { agendaItemId },
      create: { agendaItemId, ...assignData },
      update: assignData,
    })
  }

  await logActivity({
    userId:     session.user.id,
    action:     ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId:   booking.id,
    details:    { source: 'api', bookingRef: ref, sections: Object.keys(body) },
  })

  const full = await prisma.booking.findUnique({ where: { id: booking.id }, include: FULL_INCLUDE })
  return buildApiSuccess(shapeBooking(full), `Booking ${ref} updated`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createNestedData(bookingId: string, body: BookingInput, currency: string) {
  if (body.passengers?.length) {
    await prisma.passenger.createMany({
      data: body.passengers.map(p => ({
        bookingId, name: p.name,
        type: (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD',
        isLead: p.isLead ?? false, age: p.age ?? null,
        passport: p.passport ?? null, nationality: p.nationality ?? null, contact: p.contact ?? null,
      })),
    })
  }

  if (body.emergencyContacts?.length) {
    await prisma.emergencyContact.createMany({
      data: body.emergencyContacts.map(c => ({
        bookingId, name: c.name, phone: c.phone ?? null, role: c.role ?? null,
      })),
    })
  }

  if (body.flights?.length) {
    await prisma.flight.createMany({
      data: body.flights.map(f => ({
        bookingId, flightNo: f.flightNo, date: new Date(f.date),
        fromApt: f.fromApt, depTime: f.depTime ?? '', toApt: f.toApt,
        arrTime: f.arrTime ?? '', airline: f.airline ?? null, notes: f.notes ?? null,
      })),
    })
  }

  if (body.accommodations?.length) {
    await prisma.accommodation.createMany({
      data: body.accommodations.map(a => ({
        bookingId, hotel: a.hotel, city: a.city,
        checkIn: new Date(a.checkIn), checkOut: new Date(a.checkOut),
        nights: a.nights, roomType: a.roomType ?? null, mealType: a.mealType ?? null,
        address: a.address ?? null, contact: a.contact ?? null,
      })),
    })
  }

  if (body.agendaItems?.length) {
    const agenda = await prisma.tourAgenda.create({ data: { bookingId } })
    for (let i = 0; i < body.agendaItems.length; i++) {
      const item = body.agendaItems[i]
      const created = await prisma.agendaItem.create({
        data: {
          agendaId: agenda.id, date: new Date(item.date), location: item.location,
          fromPoint: item.fromPoint ?? null, toPoint: item.toPoint ?? null,
          details: item.details ?? null, mealPlan: item.mealPlan ?? null,
          meetingTime: item.meetingTime ?? null,
          serviceType: (item.serviceType ?? 'OWN_ARRANGEMENT') as never,
          sortOrder: i,
        },
      })
      if (item.assignment) {
        await prisma.assignment.create({
          data: {
            agendaItemId: created.id,
            driverId: item.assignment.driverId ?? null,
            driverName: item.assignment.driverName ?? null,
            driverPhone: item.assignment.driverPhone ?? null,
            vehicleType: item.assignment.vehicleType ?? null,
            vehiclePlate: item.assignment.vehiclePlate ?? null,
            notes: item.assignment.notes ?? null,
          },
        })
      }
    }
  }

  if (body.pnlLines?.length) {
    const pnl = await prisma.pNL.create({
      data: { bookingId, paxAdults: body.paxAdults ?? 2, paxChildren: body.paxChildren ?? 0 },
    })
    await prisma.pNLLineItem.createMany({
      data: body.pnlLines.map((l, i) => ({
        pnlId: pnl.id, activity: l.activity,
        category: (l.category ?? 'OTHER') as never,
        mmtRate: l.mmtRate ?? 0, sicRate: l.sicRate ?? 0,
        pvtRatePP: l.pvtRatePP ?? 0, adEntrance: l.adEntrance ?? 0,
        chEntrance: l.chEntrance ?? 0, otherRate: l.otherRate ?? 0,
        sortOrder: i,
      })),
    })
  }
}

// Shape the Prisma result into a clean API response
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeBooking(b: any) {
  if (!b) return null
  return {
    // ── Core ──────────────────────────────────────────────────────────────
    id:                    b.id,
    bookingRef:            b.bookingRef,
    agentBookingId:        b.agentBookingId,
    agent:                 b.agent,
    fileHandler:           b.fileHandler,
    status:                b.status,
    version:               b.version,
    amendmentNote:         b.amendmentNote,

    // ── Dates & pax ───────────────────────────────────────────────────────
    arrivalDate:           b.arrivalDate,
    departureDate:         b.departureDate,
    paxAdults:             b.paxAdults,
    paxChildren:           b.paxChildren,
    quotedTotal:           b.quotedTotal ? Number(b.quotedTotal) : null,
    currency:              b.currency,
    cancellationDeadline:  b.cancellationDeadline,
    terms:                 b.terms,
    exclusions:            b.exclusions,
    policyNotes:           b.policyNotes,

    // ── Agent contact ─────────────────────────────────────────────────────
    agentContact: {
      email:     b.agentEmail,
      phone:     b.agentPhone,
      whatsapp:  b.agentWhatsapp,
      country:   b.agentCountry,
      address:   b.agentAddress,
    },

    // ── Lead customer contact ─────────────────────────────────────────────
    clientContact: {
      email:     b.contactEmail,
      phone:     b.contactPhone,
      whatsapp:  b.contactWhatsapp,
      country:   b.contactCountry,
      address:   b.contactAddress,
    },

    // ── Passengers ────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    passengers: (b.passengers ?? []).map((p: any) => ({
      id: p.id, name: p.name, type: p.type, isLead: p.isLead,
      age: p.age, passport: p.passport, nationality: p.nationality, contact: p.contact,
    })),

    // ── Emergency contacts ────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emergencyContacts: (b.emergencyContacts ?? []).map((c: any) => ({
      id: c.id, name: c.name, phone: c.phone, role: c.role,
    })),

    // ── Flights ───────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flights: (b.flights ?? []).map((f: any) => ({
      id: f.id, flightNo: f.flightNo,
      date: f.date, fromApt: f.fromApt, depTime: f.depTime,
      toApt: f.toApt, arrTime: f.arrTime, airline: f.airline, notes: f.notes,
    })),

    // ── Accommodations ────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    accommodations: (b.accommodations ?? []).map((a: any) => ({
      id: a.id, hotel: a.hotel, city: a.city,
      checkIn: a.checkIn, checkOut: a.checkOut, nights: a.nights,
      roomType: a.roomType, mealType: a.mealType, address: a.address, contact: a.contact,
    })),

    // ── Itinerary ─────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    itineraryItems: (b.itineraryItems ?? []).map((i: any) => ({
      id: i.id, dayNo: i.dayNo, date: i.date, title: i.title, description: i.description,
    })),

    // ── Movement Chart / Agenda ───────────────────────────────────────────
    agenda: b.tourAgenda ? {
      id:        b.tourAgenda.id,
      createdAt: b.tourAgenda.createdAt,
      updatedAt: b.tourAgenda.updatedAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: (b.tourAgenda.items ?? []).map((item: any) => ({
        id:          item.id,
        date:        item.date,
        location:    item.location,
        fromPoint:   item.fromPoint,
        toPoint:     item.toPoint,
        details:     item.details,
        mealPlan:    item.mealPlan,
        meetingTime: item.meetingTime,
        serviceType: item.serviceType,
        sortOrder:   item.sortOrder,
        // ── Driver allocation ──────────────────────────────────────────
        driverAllocation: item.assignment ? {
          id:           item.assignment.id,
          driverId:     item.assignment.driverId,
          driverName:   item.assignment.driverName ?? item.assignment.driver?.name ?? null,
          driverPhone:  item.assignment.driverPhone ?? item.assignment.driver?.phone ?? null,
          vehicleType:  item.assignment.vehicleType ?? item.assignment.driver?.vehicle?.type ?? null,
          vehiclePlate: item.assignment.vehiclePlate ?? item.assignment.driver?.vehicle?.plateNo ?? null,
          notes:        item.assignment.notes,
          assignedAt:   item.assignment.assignedAt,
          driver: item.assignment.driver ? {
            id:           item.assignment.driver.id,
            name:         item.assignment.driver.name,
            phone:        item.assignment.driver.phone,
            email:        item.assignment.driver.email,
            licenseNo:    item.assignment.driver.licenseNo,
            vehicle: item.assignment.driver.vehicle ? {
              id:       item.assignment.driver.vehicle.id,
              type:     item.assignment.driver.vehicle.type,
              plateNo:  item.assignment.driver.vehicle.plateNo,
              brand:    item.assignment.driver.vehicle.brand,
              model:    item.assignment.driver.vehicle.model,
              capacity: item.assignment.driver.vehicle.capacity,
            } : null,
          } : null,
        } : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tickets: (item.tickets ?? []).map((t: any) => ({
          id: t.id, type: t.type, qty: t.qty, status: t.status,
          costPerUnit: t.costPerUnit ? Number(t.costPerUnit) : null,
          totalCost: t.totalCost ? Number(t.totalCost) : null,
        })),
      })),
    } : null,

    // ── P&L ───────────────────────────────────────────────────────────────
    pnl: b.pnl ? {
      id:          b.pnl.id,
      paxAdults:   b.pnl.paxAdults,
      paxChildren: b.pnl.paxChildren,
      lockedAt:    b.pnl.lockedAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lineItems: (b.pnl.lineItems ?? []).map((l: any) => ({
        id:             l.id,
        activity:       l.activity,
        category:       l.category,
        mmtRate:        Number(l.mmtRate),
        sicRate:        Number(l.sicRate),
        pvtRatePP:      Number(l.pvtRatePP),
        adEntrance:     Number(l.adEntrance),
        chEntrance:     Number(l.chEntrance),
        otherRate:      Number(l.otherRate),
        paymentStatus:  l.paymentStatus,
        notes:          l.notes,
        sortOrder:      l.sortOrder,
      })),
      totals: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mmtRate:    (b.pnl.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.mmtRate), 0),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sicRate:    (b.pnl.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.sicRate), 0),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pvtRatePP:  (b.pnl.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.pvtRatePP), 0),
      },
    } : null,

    // ── Payments ──────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payments: (b.payments ?? []).map((p: any) => ({
      id: p.id, type: p.type, label: p.label, amount: Number(p.amount),
      currency: p.currency, method: p.method, status: p.status,
      reference: p.reference, dueDate: p.dueDate, paidAt: p.paidAt,
    })),

    // ── Tickets ───────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tickets: (b.tickets ?? []).map((t: any) => ({
      id: t.id, type: t.type, qty: t.qty, supplier: t.supplier,
      costPerUnit: t.costPerUnit ? Number(t.costPerUnit) : null,
      totalCost: t.totalCost ? Number(t.totalCost) : null,
      currency: t.currency, status: t.status, activated: t.activated,
      reference: t.reference, notes: t.notes,
    })),

    // ── Status history ────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    statusHistory: (b.statusEvents ?? []).map((e: any) => ({
      id: e.id, from: e.fromState, to: e.toState,
      actor: e.actor, note: e.note, at: e.createdAt,
    })),

    // ── Meta ──────────────────────────────────────────────────────────────
    createdBy:  b.createdBy,
    createdAt:  b.createdAt,
    updatedAt:  b.updatedAt,
  }
}

// ─── Input types ─────────────────────────────────────────────────────────────

interface PassengerInput {
  name: string; type?: string; isLead?: boolean
  age?: number; passport?: string; nationality?: string; contact?: string
}
interface EmergencyContactInput { name: string; phone?: string; role?: string }
interface FlightInput {
  flightNo: string; date: string; fromApt: string; depTime?: string
  toApt: string; arrTime?: string; airline?: string; notes?: string
}
interface AccommodationInput {
  hotel: string; city: string; checkIn: string; checkOut: string
  nights: number; roomType?: string; mealType?: string; address?: string; contact?: string
}
interface AssignmentInput {
  driverId?: string; driverName?: string; driverPhone?: string
  vehicleType?: string; vehiclePlate?: string; notes?: string
}
interface AgendaItemInput {
  date: string; location: string; fromPoint?: string; toPoint?: string
  details?: string; mealPlan?: string; meetingTime?: string
  serviceType?: string; assignment?: AssignmentInput
}
interface PnlLineInput {
  activity: string; category?: string
  mmtRate?: number; sicRate?: number; pvtRatePP?: number
  adEntrance?: number; chEntrance?: number; otherRate?: number
}

interface BookingInput {
  bookingRef?:     string
  agentBookingId?: string
  agent?:          string
  fileHandler?:    string
  arrivalDate?:    string
  departureDate?:  string
  paxAdults?:      number
  paxChildren?:    number
  quotedTotal?:    number
  currency?:       string
  status?:         string
  terms?:          string
  exclusions?:     string
  policyNotes?:    string
  amendmentNote?:  string
  agentEmail?:     string
  agentPhone?:     string
  agentWhatsapp?:  string
  agentCountry?:   string
  agentAddress?:   string
  contactEmail?:   string
  contactPhone?:   string
  contactWhatsapp?: string
  contactCountry?: string
  contactAddress?: string
  passengers?:          PassengerInput[]
  emergencyContacts?:   EmergencyContactInput[]
  flights?:             FlightInput[]
  accommodations?:      AccommodationInput[]
  agendaItems?:         AgendaItemInput[]
  pnlLines?:            PnlLineInput[]
  // Single driver assignment patch
  assignDriver?: AssignmentInput & { agendaItemId: string }
}
