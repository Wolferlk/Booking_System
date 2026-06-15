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
  const dateFilter = searchParams.get('dateFilter') ?? ''
  const rawSortBy = searchParams.get('sortBy') ?? 'arrivalDate'
  const sortDir = searchParams.get('sortDir') === 'asc' ? ('asc' as const) : ('desc' as const)

  const ALLOWED_SORT = ['arrivalDate', 'departureDate', 'createdAt', 'updatedAt'] as const
  type SortField = typeof ALLOWED_SORT[number]
  const sortBy: SortField = (ALLOWED_SORT as readonly string[]).includes(rawSortBy)
    ? (rawSortBy as SortField)
    : 'arrivalDate'

  const role = session.user.role as UserRole

  const where: Record<string, unknown> = {}

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

  // Date period filter applied to arrivalDate
  if (dateFilter) {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (dateFilter === 'today') {
      where.arrivalDate = {
        gte: todayStart,
        lt: new Date(todayStart.getTime() + 86_400_000),
      }
    } else if (dateFilter === 'this_week') {
      const startOfWeek = new Date(todayStart)
      startOfWeek.setDate(todayStart.getDate() - todayStart.getDay())
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 7)
      where.arrivalDate = { gte: startOfWeek, lt: endOfWeek }
    } else if (dateFilter === 'this_month') {
      where.arrivalDate = {
        gte: new Date(now.getFullYear(), now.getMonth(), 1),
        lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      }
    }
  }

  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
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
    // Contact details (extracted by AI or entered manually)
    agentEmail,
    agentPhone,
    agentWhatsapp,
    agentCountry,
    contactEmail,
    contactPhone,
    contactWhatsapp,
    contactCountry,
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
      arrivalDate: new Date(arrivalDate),
      departureDate: new Date(departureDate),
      paxAdults: Number(paxAdults),
      paxChildren: Number(paxChildren),
      quotedTotal: Number(quotedTotal),
      currency,
      terms,
      exclusions,
      policyNotes,
      agentEmail:     agentEmail     || null,
      agentPhone:     agentPhone     || null,
      agentWhatsapp:  agentWhatsapp  || null,
      agentCountry:   agentCountry   || null,
      contactEmail:   contactEmail   || null,
      contactPhone:   contactPhone   || null,
      contactWhatsapp: contactWhatsapp || null,
      contactCountry: contactCountry  || null,
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
