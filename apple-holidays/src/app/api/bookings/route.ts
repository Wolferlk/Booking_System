import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, getCancellationDeadline } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '20')

  const role = session.user.role as UserRole

  const where: Record<string, unknown> = {}

  // Filter by destination — SUPER_ADMIN sees all destinations
  if (role !== 'SUPER_ADMIN') {
    where.destination = session.user.destination
  }

  // Clients can only see their own booking
  if (role === 'CLIENT') {
    where.clientUserId = session.user.id
  }

  if (status) where.status = status

  if (search) {
    where.OR = [
      { bookingRef: { contains: search } },
      { agent: { contains: search } },
      { fileHandler: { contains: search } },
      { passengers: { some: { name: { contains: search } } } },
    ]
  }

  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        passengers: { where: { isLead: true }, take: 1 },
        createdBy: { select: { id: true, name: true, role: true } },
        _count: { select: { changeRequests: true } },
      },
    }),
  ])

  return buildApiSuccess({ bookings, total, page, limit })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json()

  const {
    bookingRef,
    agentBookingId,
    agent,
    fileHandler,
    arrivalDate,
    departureDate,
    paxAdults,
    paxChildren,
    quotedTotal,
    currency = 'USD',
    terms,
    exclusions,
    policyNotes,
    passengers = [],
    flights = [],
    accommodations = [],
    itineraryItems = [],
    emergencyContacts = [],
  } = body

  if (!bookingRef || !arrivalDate || !departureDate) {
    return buildApiError('bookingRef, arrivalDate, and departureDate are required')
  }

  // Check uniqueness
  const existing = await prisma.booking.findUnique({ where: { bookingRef } })
  if (existing) return buildApiError(`Booking ref ${bookingRef} already exists`)

  const cancellationDeadline = getCancellationDeadline(arrivalDate)

  const booking = await prisma.booking.create({
    data: {
      bookingRef,
      agentBookingId,
      agent,
      fileHandler,
      destination: session.user.destination,
      arrivalDate: new Date(arrivalDate),
      departureDate: new Date(departureDate),
      paxAdults: Number(paxAdults),
      paxChildren: Number(paxChildren),
      quotedTotal: Number(quotedTotal),
      currency,
      terms,
      exclusions,
      policyNotes,
      cancellationDeadline,
      createdById: session.user.id,
      passengers: {
        create: passengers.map((p: Record<string, unknown>) => ({
          name: p.name as string,
          type: (p.type as string) || 'ADULT',
          age: p.age ? Number(p.age) : null,
          isLead: Boolean(p.isLead),
          passport: p.passport as string | undefined,
          nationality: p.nationality as string | undefined,
          contact: p.contact as string | undefined,
        })),
      },
      flights: {
        create: flights.map((f: Record<string, unknown>) => ({
          flightNo: f.flightNo as string,
          date: new Date(f.date as string),
          fromApt: f.fromApt as string,
          depTime: f.depTime as string,
          toApt: f.toApt as string,
          arrTime: f.arrTime as string,
          airline: f.airline as string | undefined,
        })),
      },
      accommodations: {
        create: accommodations.map((a: Record<string, unknown>) => ({
          city: a.city as string,
          hotel: a.hotel as string,
          checkIn: new Date(a.checkIn as string),
          checkOut: new Date(a.checkOut as string),
          address: a.address as string | undefined,
          contact: a.contact as string | undefined,
          nights: Number(a.nights),
          roomType: a.roomType as string | undefined,
          mealType: a.mealType as string | undefined,
        })),
      },
      itineraryItems: {
        create: itineraryItems.map((i: Record<string, unknown>) => ({
          dayNo: Number(i.dayNo),
          date: new Date(i.date as string),
          title: i.title as string,
          description: i.description as string | undefined,
          inclusions: i.inclusions ? JSON.stringify(i.inclusions) : null,
          exclusions: i.exclusions ? JSON.stringify(i.exclusions) : null,
        })),
      },
      emergencyContacts: {
        create: emergencyContacts.map((e: Record<string, unknown>) => ({
          name: e.name as string,
          phone: e.phone as string | undefined,
          role: e.role as string | undefined,
        })),
      },
    },
    include: {
      passengers: true,
      flights: true,
      accommodations: true,
      itineraryItems: true,
      emergencyContacts: true,
      createdBy: { select: { id: true, name: true, role: true } },
    },
  })

  // Log status event
  await prisma.statusEvent.create({
    data: {
      bookingId: booking.id,
      toState: 'DRAFT',
      actorId: session.user.id,
      note: 'Booking created',
    },
  })

  return buildApiSuccess(booking, 'Booking created successfully')
}
