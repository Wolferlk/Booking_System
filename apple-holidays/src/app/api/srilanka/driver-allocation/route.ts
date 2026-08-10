import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { backfillSlAllocationsFromAgenda } from '@/lib/sl-driver-allocation-sync'
import { HOTEL_ONLY_VEHICLE } from '@/lib/driver-requirement'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

// ── GET — all Sri Lanka bookings with their driver allocations ────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'booking:read')) return buildApiError('Forbidden', 403)

  const { searchParams } = req.nextUrl
  const search       = searchParams.get('search')  ?? ''
  const statusFilter = searchParams.get('status')  ?? ''
  const vehicleFilter = searchParams.get('vehicle') ?? ''

  const andClauses: Record<string, unknown>[] = [
    { operationCountry: 'SRILANKA' },
    // Cancelled bookings drop out of every operational list.
    { status: { not: 'CANCELLED' } },
  ]

  if (search) {
    andClauses.push({
      OR: [
        { bookingRef:  { contains: search } },
        { isNumber:    { contains: search } },
        { cntlNumber:  { contains: search } },
        { agent:       { contains: search } },
        { fileHandler: { contains: search } },
        { passengers:  { some: { name: { contains: search } } } },
      ],
    })
  }

  if (statusFilter === 'assigned') {
    andClauses.push({ slDriverAllocation: { driverId: { not: null } } })
  } else if (statusFilter === 'vendor') {
    andClauses.push({ slDriverAllocation: { vendorId: { not: null }, driverId: null } })
  } else if (statusFilter === 'pending') {
    // A Hotel Only file needs no driver, so it is complete — never pending.
    // Charts where every movement is individually marked hotel-only or leisure
    // are filtered out client-side, where the movements are already in hand.
    andClauses.push({
      OR: [
        { slDriverAllocation: null },
        { slDriverAllocation: { driverId: null, vendorId: null, vehicleType: { not: HOTEL_ONLY_VEHICLE } } },
      ],
    })
  } else if (statusFilter === 'hotel_only') {
    andClauses.push({ slDriverAllocation: { vehicleType: HOTEL_ONLY_VEHICLE } })
  } else if (statusFilter === 'emergency') {
    andClauses.push({ slDriverAllocation: { isEmergency: true } })
  }

  if (vehicleFilter) {
    andClauses.push({ slDriverAllocation: { vehicleType: vehicleFilter } })
  }

  try {
    // Files whose driver was set on the Movement Chart carry the assignment on the
    // agenda only. Adopt those onto the allocation row before reading, so the board
    // (and its status filters and counters) sees the driver that is already on the
    // trip rather than reporting the file as pending.
    try {
      await backfillSlAllocationsFromAgenda()
    } catch (syncErr) {
      console.error('[SL driver-allocation GET] agenda backfill failed (non-fatal):', syncErr)
    }

    const bookings = await prisma.booking.findMany({
      where: { AND: andClauses },
      select: {
        id:              true,
        bookingRef:      true,
        isNumber:        true,
        cntlNumber:      true,
        agent:           true,
        agentPhone:      true,
        fileHandler:     true,
        arrivalDate:     true,
        departureDate:   true,
        createdAt:       true,
        status:          true,
        paxAdults:       true,
        paxChildren:     true,
        contactPhone:    true,
        contactEmail:    true,
        tourDestination: true,
        importantNotes:  true,
        passengers: {
          where: { isLead: true },
          take: 1,
          select: { name: true, contact: true },
        },
        flights: {
          orderBy: { date: 'asc' },
          select: {
            id: true, flightNo: true, date: true,
            fromApt: true, depTime: true, toApt: true, arrTime: true, airline: true,
          },
        },
        accommodations: {
          orderBy: { checkIn: 'asc' },
          select: {
            id: true, hotel: true, city: true,
            checkIn: true, checkOut: true, nights: true, roomType: true, mealType: true,
          },
        },
        itineraryItems: {
          orderBy: { dayNo: 'asc' },
          select: { id: true, dayNo: true, date: true, title: true, description: true },
        },
        tourAgenda: {
          select: {
            items: {
              orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
              select: {
                id: true, date: true, location: true,
                fromPoint: true, toPoint: true, details: true,
                timeFrom: true, timeTo: true, serviceType: true,
                // Movements that need no driver — the board reads these to tell
                // an unallocated file from one that simply isn't driven.
                isLeisure: true, isHotelOnly: true,
                assignment: {
                  select: {
                    driverName: true, driverPhone: true, vendorName: true,
                    vehicleType: true, vehiclePlate: true,
                    driver: { select: { id: true, name: true, phone: true } },
                    vendor: { select: { id: true, name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
        slDriverAllocation: {
          select: {
            id: true, vehicleType: true, driverId: true, vendorId: true,
            notes: true, isEmergency: true, changeReason: true, changedAt: true,
            createdAt: true, updatedAt: true,
            driver: {
              select: {
                id: true, name: true, phone: true, isActive: true, photoUrl: true,
                country: true,
                vehicle: { select: { id: true, type: true, plateNo: true, brand: true, model: true } },
              },
            },
            vendor: {
              select: { id: true, name: true, phone: true, isActive: true },
            },
          },
        },
      },
      orderBy: { arrivalDate: 'asc' },
    })

    return buildApiSuccess(bookings)
  } catch (err) {
    console.error('[SL driver-allocation GET]', err)
    return buildApiError('Failed to load Sri Lanka bookings', 500)
  }
}

// ── POST — create or update a SL driver allocation ───────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'assignment:create')) return buildApiError('Forbidden', 403)

  let body: {
    bookingId: string
    vehicleType?: string | null
    driverId?: string | null
    vendorId?: string | null
    notes?: string | null
    isEmergency?: boolean
    changeReason?: string | null
  }

  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON', 400)
  }

  const { bookingId, vehicleType, driverId, vendorId, notes, isEmergency, changeReason } = body
  if (!bookingId) return buildApiError('bookingId required', 400)

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, operationCountry: true },
    })
    if (!booking) return buildApiError('Booking not found', 404)
    if (booking.operationCountry !== 'SRILANKA') return buildApiError('Not a Sri Lanka booking', 400)

    // Read before the upsert overwrites it — the Hotel Only sync below acts on
    // the *change* of vehicle type, not on its value, so that a plain driver
    // assignment never disturbs hotel-only marks made on the movement chart.
    const previous = await prisma.sriLankaDriverAllocation.findUnique({
      where:  { bookingId },
      select: { vehicleType: true },
    })

    const allocation = await prisma.sriLankaDriverAllocation.upsert({
      where: { bookingId },
      create: {
        bookingId,
        vehicleType:  vehicleType  ?? null,
        driverId:     driverId     ?? null,
        vendorId:     vendorId     ?? null,
        notes:        notes        ?? null,
        isEmergency:  isEmergency  ?? false,
        changeReason: changeReason ?? null,
        changedAt:    driverId || vendorId ? new Date() : null,
      },
      update: {
        vehicleType:  vehicleType  ?? null,
        driverId:     driverId     ?? null,
        vendorId:     vendorId     ?? null,
        notes:        notes        ?? null,
        isEmergency:  isEmergency  ?? false,
        changeReason: changeReason ?? null,
        changedAt:    driverId || vendorId ? new Date() : undefined,
      },
      include: {
        driver: {
          select: {
            id: true, name: true, phone: true, isActive: true, photoUrl: true,
            vehicle: { select: { id: true, type: true, plateNo: true, brand: true, model: true } },
          },
        },
        vendor: { select: { id: true, name: true, phone: true, isActive: true } },
      },
    })

    // ── Sync driver/vendor to all agenda item assignments ─────────────────────
    // Resolve display values from the returned allocation
    const driverRec = allocation.driver
    const vendorRec = allocation.vendor

    // A vehicle-type change carries no driver or vendor. It must not blank the
    // drivers already set per movement on the chart — only the vehicle travels.
    const isDriverChange = !!(driverId || vendorId)

    const assignmentData = isDriverChange
      ? {
          driverId:     driverId   ?? null,
          vendorId:     vendorId   ?? null,
          driverName:   driverRec?.name   ?? vendorRec?.name   ?? null,
          driverPhone:  driverRec?.phone  ?? vendorRec?.phone  ?? null,
          vehicleType:  vehicleType ?? driverRec?.vehicle?.type ?? null,
          vehiclePlate: driverRec?.vehicle?.plateNo ?? null,
          vendorName:   vendorRec?.name ?? null,
        }
      : { vehicleType: vehicleType ?? null }

    const agenda = await prisma.tourAgenda.findUnique({
      where: { bookingId },
      select: { items: { select: { id: true } } },
    })

    // ── Hotel Only ↔ Movement Chart ───────────────────────────────────────────
    // Choosing Hotel Only on the board means the whole file carries no transport,
    // so every movement is marked hotel-only and any driver already on the chart
    // is released — the chart must not keep showing a driver for a file the board
    // now reports as needing none. Switching back to a real vehicle lifts the mark
    // off again, putting the Assign Driver controls back on every movement.
    const isHotelOnly   = vehicleType === HOTEL_ONLY_VEHICLE
    const wasHotelOnly  = previous?.vehicleType === HOTEL_ONLY_VEHICLE
    if (agenda?.items.length && isHotelOnly !== wasHotelOnly) {
      const itemIds = agenda.items.map(i => i.id)
      await prisma.agendaItem.updateMany({
        where: { id: { in: itemIds } },
        data:  { isHotelOnly },
      })
      if (isHotelOnly) {
        await prisma.assignment.deleteMany({ where: { agendaItemId: { in: itemIds } } })
      }
    }

    // A hotel-only file holds no driver at booking level either.
    if (isHotelOnly && (allocation.driverId || allocation.vendorId)) {
      await prisma.sriLankaDriverAllocation.update({
        where: { bookingId },
        data:  { driverId: null, vendorId: null },
      })
      allocation.driverId = null
      allocation.vendorId = null
      allocation.driver   = null
      allocation.vendor   = null
    }

    if (agenda?.items.length && !isHotelOnly) {
      await Promise.all(
        agenda.items.map(item =>
          isDriverChange
            ? prisma.assignment.upsert({
                where:  { agendaItemId: item.id },
                create: { agendaItemId: item.id, ...assignmentData },
                update: assignmentData,
              })
            // No driver in play — touch the vehicle on movements that already
            // have an assignment rather than creating empty ones.
            : prisma.assignment.updateMany({
                where: { agendaItemId: item.id },
                data:  assignmentData,
              })
        )
      )
    }

    return buildApiSuccess(allocation)
  } catch (err) {
    console.error('[SL driver-allocation POST]', err)
    return buildApiError('Failed to save allocation', 500)
  }
}
