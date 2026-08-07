import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, getCancellationDeadline } from '@/lib/utils'
import { hasPermission, canSeeAllCountries } from '@/lib/rbac'
import { detectCountryFromRef, countryScope, userCountryScope, isInCountryScope } from '@/lib/country-detection'
import { isTripState, tripStateWhere } from '@/lib/trip-state'
import { bookingSourceWhere } from '@/lib/booking-source'
import { isQuickFilter, quickFilterWhere } from '@/lib/booking-quick-filters'
import type { UserRole } from '@prisma/client'
import type { OperationCountry } from '@/lib/country-detection'

export const dynamic = 'force-dynamic'

// Calendar inputs are date-only values. Build explicit UTC boundaries so the
// inclusive end date does not depend on the server's local timezone.
function calendarBoundary(value: string, endOfDay = false): Date {
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
}
/**
 * Space-insensitive lookup for ref-type columns (isNumber, bookingRef, agentBookingId).
 * "IS 48638" and "IS48638" are treated as identical — spaces are stripped from both the
 * stored value and the search term before matching, so it works regardless of which side
 * happens to carry the space. Returns the bookingRefs of any matches.
 */
async function refsMatchingSpaceInsensitive(term: string): Promise<string[]> {
  const norm = term.replace(/\s+/g, '')
  if (!norm) return []
  // Escape LIKE wildcards so a literal % or _ in the term isn't treated as a pattern.
  const like = `%${norm.replace(/[\\%_]/g, c => `\\${c}`)}%`
  const rows = await prisma.$queryRaw<{ bookingRef: string }[]>`
    SELECT bookingRef FROM bookings
    WHERE REPLACE(isNumber, ' ', '')       LIKE ${like}
       OR REPLACE(bookingRef, ' ', '')     LIKE ${like}
       OR REPLACE(agentBookingId, ' ', '') LIKE ${like}
    LIMIT 500
  `
  return rows.map(r => r.bookingRef)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const refSearch = searchParams.get('refSearch')           // IS number / VN ref / agent ID
  const contentSearch = searchParams.get('contentSearch')   // deep search in agenda/booking details
  const dateFrom = searchParams.get('dateFrom')     // range start (column chosen by dateField)
  const dateTo   = searchParams.get('dateTo')       // range end   (column chosen by dateField)
  const page  = parseInt(searchParams.get('page')  ?? '1')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const dateFilter = searchParams.get('dateFilter') ?? ''
  // Sales channel filter: B2B (agent bookings) vs B2C (Aahaas store orders).
  const source = searchParams.get('source')
  // Which date column the period pills AND the explicit range apply to (arrival vs created)
  const dateField = searchParams.get('dateField') === 'createdAt' ? 'createdAt' : 'arrivalDate'
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

  const sourceClause = bookingSourceWhere(source)
  if (sourceClause) andClauses.push(sourceClause)

  // The status param accepts the two derived post-travel states alongside real
  // BookingStatus values — they are split out and translated into date/feedback
  // conditions, since they exist nowhere in the status column.
  const requestedStates = status ? status.split(',').filter(Boolean) : []
  const tripStates = requestedStates.filter(isTripState)
  const statuses = requestedStates.filter(s => !isTripState(s))

  if (tripStates.length > 0) {
    const now = new Date()
    const fragments = tripStates.map(s => tripStateWhere(s, now))
    andClauses.push(fragments.length === 1 ? fragments[0] : { OR: fragments })
  }

  if (statuses.length > 0) {
    andClauses.push(statuses.length === 1 ? { status: statuses[0] } : { status: { in: statuses } })
  }

  // Cancelled bookings are kept out of every list by default. Only the full
  // bookings list (which asks for them explicitly, and shades them red) and an
  // explicit status=CANCELLED filter bring them back.
  const includeCancelled = searchParams.get('includeCancelled') === '1'
  if (!includeCancelled && !statuses.includes('CANCELLED')) {
    andClauses.push({ status: { not: 'CANCELLED' } })
  }

  if (search) {
    const refMatches = await refsMatchingSpaceInsensitive(search)
    andClauses.push({
      OR: [
        { bookingRef:     { contains: search } },
        { agent:          { contains: search } },
        { fileHandler:    { contains: search } },
        { isNumber:       { contains: search } },
        { agentBookingId: { contains: search } },
        { passengers: { some: { name: { contains: search } } } },
        ...(refMatches.length ? [{ bookingRef: { in: refMatches } }] : []),
      ],
    })
  }

  // Deep content search — searches inside flights, hotels, itinerary, agenda items
  if (contentSearch) {
    const refMatches = await refsMatchingSpaceInsensitive(contentSearch)
    andClauses.push({
      OR: [
        ...(refMatches.length ? [{ bookingRef: { in: refMatches } }] : []),
        { bookingRef:     { contains: contentSearch } },
        { agent:          { contains: contentSearch } },
        { isNumber:       { contains: contentSearch } },
        { agentBookingId: { contains: contentSearch } },
        { passengers:     { some: { name: { contains: contentSearch } } } },
        { flights:        { some: { OR: [
          { flightNo: { contains: contentSearch } },
          { airline:  { contains: contentSearch } },
          { fromApt:  { contains: contentSearch } },
          { toApt:    { contains: contentSearch } },
        ] } } },
        { accommodations: { some: { OR: [
          { hotel: { contains: contentSearch } },
          { city:  { contains: contentSearch } },
        ] } } },
        { itineraryItems: { some: { OR: [
          { title:       { contains: contentSearch } },
          { description: { contains: contentSearch } },
        ] } } },
        { tourAgenda: { is: { items: { some: { OR: [
          { location:  { contains: contentSearch } },
          { fromPoint: { contains: contentSearch } },
          { toPoint:   { contains: contentSearch } },
          { details:   { contains: contentSearch } },
        ] } } } } },
      ],
    })
  }

  // Ref / IS number / agent ID dedicated search
  if (refSearch) {
    const refMatches = await refsMatchingSpaceInsensitive(refSearch)
    andClauses.push({
      OR: [
        { bookingRef:     { contains: refSearch } },
        { isNumber:       { contains: refSearch } },
        { agentBookingId: { contains: refSearch } },
        ...(refMatches.length ? [{ bookingRef: { in: refMatches } }] : []),
      ],
    })
  }

  // Explicit date range on the chosen date column (arrivalDate or createdAt)
  if (dateFrom || dateTo) {
    const range: Record<string, Date> = {}
    if (dateFrom) range.gte = calendarBoundary(dateFrom)
    if (dateTo) {
      const end = calendarBoundary(dateTo, true)
      range.lte = end
    }
    andClauses.push({ [dateField]: range })
  }

  // Date period filter applied to the chosen date column (arrivalDate or createdAt)
  if (dateFilter) {
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setUTCHours(0, 0, 0, 0)
    if (dateFilter === 'today') {
      andClauses.push({
        [dateField]: {
          gte: todayStart,
          lt: new Date(todayStart.getTime() + 86_400_000),
        },
      })
    } else if (dateFilter === 'this_week') {
      const startOfWeek = new Date(todayStart)
      startOfWeek.setUTCDate(todayStart.getUTCDate() - todayStart.getUTCDay())
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 7)
      andClauses.push({ [dateField]: { gte: startOfWeek, lt: endOfWeek } })
    } else if (dateFilter === 'this_month') {
      andClauses.push({
        [dateField]: {
          gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
          lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
        },
      })
    }
  }

  // Operational quick filter (on ground / arriving today / …) from the stat cards.
  const quick = searchParams.get('quick')
  if (quick && isQuickFilter(quick)) {
    andClauses.push(quickFilterWhere(quick) as Record<string, unknown>)
  }

  const where: Record<string, unknown> = andClauses.length > 0 ? { AND: andClauses } : {}

  const baseInclude = {
    createdBy: { select: { id: true, name: true, role: true } },
    _count: { select: { changeRequests: true } },
    pnl: { select: { id: true } },
    // Drives the post-travel status badge ("Trip Completed" vs "…Pending Customer Review")
    guestFeedback: { select: { submittedAt: true } },
  }

  // When deep-searching, pull back extra context fields so the UI can show snippets
  const include = contentSearch ? {
    ...baseInclude,
    passengers:      { select: { name: true, isLead: true } },
    flights:         { select: { flightNo: true, airline: true, fromApt: true, toApt: true } },
    accommodations:  { select: { hotel: true, city: true } },
    itineraryItems:  { select: { title: true, description: true } },
    tourAgenda: {
      select: {
        id: true,
        items: { select: { location: true, fromPoint: true, toPoint: true, details: true } },
      },
    },
  } : {
    ...baseInclude,
    passengers:  { where: { isLead: true }, take: 1 },
    tourAgenda:  { select: { id: true } },
  }

  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * limit,
      take: limit,
      include,
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

  // Auto-populate isNumber from bookingRef if it matches IS/VN/SG/MY pattern
  const IS_NUMBER_RE = /^(IS|VN|SG|MY)\d+/i
  const resolvedIsNumber = body.isNumber?.trim() || (IS_NUMBER_RE.test(bookingRef) ? bookingRef : null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booking = await (prisma.booking.create as any)({
    data: {
      bookingRef,
      agentBookingId,
      isNumber: resolvedIsNumber || null,
      cntlNumber: cntlNumber || null,
      agent,
      fileHandler,
      arrivalDate: new Date(arrivalDate),
      departureDate: new Date(departureDate),
      paxAdults: Number(paxAdults),
      paxChildren: Number(paxChildren),
      quotedTotal: quotedTotal != null && String(quotedTotal).trim() !== '' && Number.isFinite(Number(quotedTotal))
        ? Number(quotedTotal)
        : null,
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
          title: String(i.title ?? '').slice(0, 1000),
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
