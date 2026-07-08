import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
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
    andClauses.push({
      OR: [
        { slDriverAllocation: null },
        { slDriverAllocation: { driverId: null, vendorId: null } },
      ],
    })
  } else if (statusFilter === 'emergency') {
    andClauses.push({ slDriverAllocation: { isEmergency: true } })
  }

  if (vehicleFilter) {
    andClauses.push({ slDriverAllocation: { vehicleType: vehicleFilter } })
  }

  try {
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
                assignment: {
                  select: {
                    driverName: true, vehicleType: true, vehiclePlate: true,
                    driver: { select: { id: true, name: true, phone: true } },
                    vendor: { select: { id: true, name: true } },
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

    return buildApiSuccess(allocation)
  } catch (err) {
    console.error('[SL driver-allocation POST]', err)
    return buildApiError('Failed to save allocation', 500)
  }
}
