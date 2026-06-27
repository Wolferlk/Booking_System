import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, getCancellationDeadline } from '@/lib/utils'
import { hasPermission, canSeeAllCountries } from '@/lib/rbac'
import { detectCountryFromRef, countryScope, userCountryScope, isInCountryScope } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'
import type { OperationCountry } from '@/lib/country-detection'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const refSearch = searchParams.get('refSearch')   // IS number / VN ref / agent ID
  const dateFrom = searchParams.get('dateFrom')     // createdAt range start
  const dateTo   = searchParams.get('dateTo')       // createdAt range end
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
  const userCountry = (session.user as any).country as string | undefined
  const userCountries = (session.user as any).countries as string[] | undefined
  const countryOverride = searchParams.get('country')

  const andClauses: Record<string, unknown>[] = []

  if (role === 'CLIENT') {
    andClauses.push({ clientUserId: session.user.id })
  } else if (!canSeeAllCountries(role, userCountry as any)) {
    // Country-scoped users (including multi-country) only see their assigned scope.
    const scope = userCountryScope(userCountry, userCountries)
    if (scope) andClauses.push({ operationCountry: { in: scope } })
  } else if (countryOverride && countryOverride !== 'ALL') {
    // Admin explicit filter: SINGAPORE / MALAYSIA stay EXACT so each shows on its own;
    // only the legacy combined value expands to the whole SG/MY group.
    if (countryOverride === 'SINGAPORE_MALAYSIA') {
      andClauses.push({ operationCountry: { in: countryScope(countryOverride)! } })
    } else {
      andClauses.push({ operationCountry: countryOverride })
    }
  }

  if (status) {
    const statuses = status.split(',').filter(Boolean)
    andClauses.push(statuses.length === 1 ? { status: statuses[0] } : { status: { in: statuses } })
  }

  if (search) {
    andClauses.push({
      OR: [
        { bookingRef:     { contains: search } },
        { agent:          { contains: search } },
        { fileHandler:    { contains: search } },
        { isNumber:       { contains: search } },
        { agentBookingId: { contains: search } },
        { passengers: { some: { name: { contains: search } } } },
      ],
    })
  }

  // Ref / IS number / agent ID dedicated search
  if (refSearch) {
    andClauses.push({
      OR: [
        { bookingRef:     { contains: refSearch } },
        { isNumber:       { contains: refSearch } },
        { agentBookingId: { contains: refSearch } },
      ],
    })
  }

  // Created-at date range
  if (dateFrom || dateTo) {
    const createdRange: Record<string, Date> = {}
    if (dateFrom) createdRange.gte = new Date(dateFrom)
    if (dateTo) {
      const end = new Date(dateTo)
      end.setHours(23, 59, 59, 999)
      createdRange.lte = end
    }
    andClauses.push({ createdAt: createdRange })
  }

  // Date period filter applied to arrivalDate
  if (dateFilter) {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (dateFilter === 'today') {
      andClauses.push({
        arrivalDate: {
        gte: todayStart,
        lt: new Date(todayStart.getTime() + 86_400_000),
        },
      })
    } else if (dateFilter === 'this_week') {
      const startOfWeek = new Date(todayStart)
      startOfWeek.setDate(todayStart.getDate() - todayStart.getDay())
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 7)
      andClauses.push({ arrivalDate: { gte: startOfWeek, lt: endOfWeek } })
    } else if (dateFilter === 'this_month') {
      andClauses.push({
        arrivalDate: {
        gte: new Date(now.getFullYear(), now.getMonth(), 1),
        lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        },
      })
    }
  }

  const where: Record<string, unknown> = andClauses.length > 0 ? { AND: andClauses } : {}

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
        pnl: { select: { id: true } },
        tourAgenda: { select: { id: true } },
      },
    }),
  ])

  return buildApiSuccess({ bookings, total, page, limit })
}

export async function POST(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json()

  const {
    bookingRef,
    agentBookingId,
    cntlNumber,
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
    amendmentNote,
    // Additional TC sections
    valueAddedServices,
    packageIncludes,
    packageExcludes,
    importantNotes,
    tips,
    otherNote,
    clientRequest,
    // Country explicitly selected by user (overrides ref-based detection)
    operationCountry: bodyCountry,
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

  // Country resolution: explicit body value → ref prefix → session country
  const VALID_COUNTRIES: OperationCountry[] = ['VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA']
  const validatedBodyCountry = VALID_COUNTRIES.includes(bodyCountry as OperationCountry)
    ? (bodyCountry as OperationCountry)
    : null
  const detectedCountry = detectCountryFromRef(bookingRef)
  const sessionCountry = session.user.country as OperationCountry | undefined
  const operationCountry =
    validatedBodyCountry ??
    detectedCountry ??
    (sessionCountry && sessionCountry !== 'ALL' ? sessionCountry : null)
  if (!operationCountry) {
    return buildApiError('Please select a destination country before creating the booking')
  }
  if (sessionCountry && sessionCountry !== 'ALL' && !isInCountryScope(operationCountry, sessionCountry)) {
    return buildApiError('Forbidden — booking country must match your assigned country', 403)
  }

  const cancellationDeadline = getCancellationDeadline(arrivalDate)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booking = await (prisma.booking.create as any)({
    data: {
      bookingRef,
      agentBookingId,
      cntlNumber: cntlNumber || null,
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
      amendmentNote: amendmentNote || null,
      valueAddedServices: valueAddedServices || null,
      packageIncludes:    packageIncludes    || null,
      packageExcludes:    packageExcludes    || null,
      importantNotes:     importantNotes     || null,
      tips:               tips               || null,
      otherNote:          otherNote          || null,
      clientRequest:      clientRequest      || null,
      agentEmail:     agentEmail     || null,
      agentPhone:     agentPhone     || null,
      agentWhatsapp:  agentWhatsapp  || null,
      agentCountry:   agentCountry   || null,
      contactEmail:   contactEmail   || null,
      contactPhone:   contactPhone   || null,
      contactWhatsapp: contactWhatsapp || null,
      contactCountry: contactCountry  || null,
      cancellationDeadline,
      operationCountry,
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
          mealPreference: (p.mealPreference as string) || null,
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
  } catch (err: unknown) {
    console.error('[POST /api/bookings]', err)
    const message = err instanceof Error ? err.message : String(err)
    return buildApiError(`Internal server error: ${message}`, 500)
  }
}
