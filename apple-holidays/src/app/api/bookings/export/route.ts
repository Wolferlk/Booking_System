import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope } from '@/lib/country-detection'
import { isTripState, tripStateWhere } from '@/lib/trip-state'
import { bookingSourceWhere } from '@/lib/booking-source'
import { isQuickFilter, quickFilterWhere } from '@/lib/booking-quick-filters'
import * as XLSX from 'xlsx'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const status        = searchParams.get('status')
  const search        = searchParams.get('search')
  const refSearch     = searchParams.get('refSearch')
  const contentSearch = searchParams.get('contentSearch')
  const dateFrom      = searchParams.get('dateFrom')
  const dateTo        = searchParams.get('dateTo')
  const dateFilter    = searchParams.get('dateFilter') ?? ''
  const source        = searchParams.get('source')
  const dateField     = searchParams.get('dateField') === 'createdAt' ? 'createdAt' : 'arrivalDate'
  const rawSortBy     = searchParams.get('sortBy') ?? 'createdAt'
  const sortDir       = searchParams.get('sortDir') === 'asc' ? ('asc' as const) : ('desc' as const)

  const ALLOWED_SORT = ['arrivalDate', 'departureDate', 'createdAt', 'updatedAt'] as const
  type SortField = typeof ALLOWED_SORT[number]
  const sortBy: SortField = (ALLOWED_SORT as readonly string[]).includes(rawSortBy)
    ? (rawSortBy as SortField) : 'createdAt'

  const role         = session.user.role as UserRole
  const userCountry  = (session.user as any).country as string | undefined
  const userCountries = (session.user as any).countries as string[] | undefined
  const countryOverride = searchParams.get('country')

  const andClauses: Record<string, unknown>[] = []

  if (role === 'CLIENT') {
    andClauses.push({ clientUserId: session.user.id })
  } else if (!canSeeAllCountries(role, userCountry as any)) {
    const scope = userCountryScope(userCountry, userCountries)
    if (scope) andClauses.push({ operationCountry: { in: scope } })
  } else if (countryOverride && countryOverride !== 'ALL') {
    if (countryOverride === 'SINGAPORE_MALAYSIA') {
      andClauses.push({ operationCountry: { in: countryScope(countryOverride)! } })
    } else {
      andClauses.push({ operationCountry: countryOverride })
    }
  }

  const sourceClause = bookingSourceWhere(source)
  if (sourceClause) andClauses.push(sourceClause)

  if (status) {
    // Derived post-travel states are not stored in the status column — they are
    // translated to date/feedback conditions (see src/lib/trip-state.ts).
    const requestedStates = status.split(',').filter(Boolean)
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

  if (refSearch) {
    andClauses.push({
      OR: [
        { bookingRef:     { contains: refSearch } },
        { isNumber:       { contains: refSearch } },
        { agentBookingId: { contains: refSearch } },
      ],
    })
  }

  if (contentSearch) {
    andClauses.push({
      OR: [
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

  if (dateFilter) {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (dateFilter === 'today') {
      andClauses.push({ [dateField]: { gte: todayStart, lt: new Date(todayStart.getTime() + 86_400_000) } })
    } else if (dateFilter === 'this_week') {
      const startOfWeek = new Date(todayStart)
      startOfWeek.setDate(todayStart.getDate() - todayStart.getDay())
      andClauses.push({ [dateField]: { gte: startOfWeek, lt: new Date(startOfWeek.getTime() + 7 * 86_400_000) } })
    } else if (dateFilter === 'this_month') {
      andClauses.push({
        [dateField]: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
          lt:  new Date(now.getFullYear(), now.getMonth() + 1, 1),
        },
      })
    }
  }

  // Operational quick filter (on ground / arriving today / …) from the stat cards.
  const quick = searchParams.get('quick')
  if (quick && isQuickFilter(quick)) {
    andClauses.push(quickFilterWhere(quick) as Record<string, unknown>)
  }

  // Hotel Only — mirrors the switch on the bookings list, so a download or a
  // printout of a filtered screen contains what the screen showed.
  const hotelOnlyParam = searchParams.get('hotelOnly')
  if (hotelOnlyParam === '1') andClauses.push({ hotelOnly: true })
  else if (hotelOnlyParam === '0') andClauses.push({ hotelOnly: false })

  const where: Record<string, unknown> = andClauses.length > 0 ? { AND: andClauses } : {}

  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { [sortBy]: sortDir },
    take: 2000,
    include: {
      passengers:     { select: { name: true, isLead: true, passport: true, nationality: true } },
      flights:        { select: { flightNo: true, airline: true, date: true, fromApt: true, depTime: true, toApt: true, arrTime: true } },
      accommodations: { select: { hotel: true, city: true, checkIn: true, checkOut: true, nights: true, roomType: true } },
      createdBy:      { select: { name: true } },
    },
  })

  // ── Build workbook ────────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new()
  const fmt = (d: string | Date | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

  // ── Sheet 1: Bookings Summary ─────────────────────────────────────────────
  const summaryRows: unknown[][] = [[
    '#', 'Booking Ref', 'IS / VN Number', 'Agent Booking ID', 'Country',
    'Lead Passenger', 'All Passengers', 'Agent', 'File Handler',
    'Arrival', 'Departure', 'Nights',
    'Pax Adults', 'Pax Children', 'Total Pax',
    'Quoted Total', 'Currency',
    'Status', 'Created By', 'Created Date',
  ]]

  for (let idx = 0; idx < bookings.length; idx++) {
    const b = bookings[idx]
    const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
    const allNames = b.passengers.map(p => p.name + (p.isLead ? ' (Lead)' : '')).join(', ')
    const nights = b.departureDate && b.arrivalDate
      ? Math.round((new Date(b.departureDate).getTime() - new Date(b.arrivalDate).getTime()) / 86_400_000)
      : ''

    summaryRows.push([
      idx + 1,
      b.bookingRef,
      b.isNumber ?? '',
      b.agentBookingId ?? '',
      b.operationCountry ?? '',
      lead?.name ?? '',
      allNames,
      b.agent ?? '',
      b.fileHandler ?? '',
      fmt(b.arrivalDate),
      fmt(b.departureDate),
      nights,
      b.paxAdults,
      b.paxChildren,
      b.paxAdults + b.paxChildren,
      Number(b.quotedTotal),
      b.currency,
      b.status,
      b.createdBy?.name ?? '',
      fmt(b.createdAt),
    ])
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)

  // Column widths
  wsSummary['!cols'] = [
    { wch: 4 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
    { wch: 24 }, { wch: 40 }, { wch: 20 }, { wch: 16 },
    { wch: 12 }, { wch: 12 }, { wch: 7 },
    { wch: 10 }, { wch: 10 }, { wch: 9 },
    { wch: 14 }, { wch: 8 },
    { wch: 16 }, { wch: 18 }, { wch: 14 },
  ]

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Bookings')

  // ── Sheet 2: Flights ──────────────────────────────────────────────────────
  const flightRows: unknown[][] = [['Booking Ref', 'Flight No', 'Airline', 'Date', 'From', 'Dep Time', 'To', 'Arr Time']]
  for (const b of bookings) {
    for (const f of b.flights) {
      flightRows.push([b.bookingRef, f.flightNo, f.airline ?? '', fmt(f.date), f.fromApt, f.depTime ?? '', f.toApt, f.arrTime ?? ''])
    }
  }
  const wsFlights = XLSX.utils.aoa_to_sheet(flightRows)
  wsFlights['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, wsFlights, 'Flights')

  // ── Sheet 3: Accommodations ───────────────────────────────────────────────
  const hotelRows: unknown[][] = [['Booking Ref', 'Hotel', 'City', 'Check-in', 'Check-out', 'Nights', 'Room Type']]
  for (const b of bookings) {
    for (const a of b.accommodations) {
      hotelRows.push([b.bookingRef, a.hotel, a.city, fmt(a.checkIn), fmt(a.checkOut), a.nights, a.roomType ?? ''])
    }
  }
  const wsHotels = XLSX.utils.aoa_to_sheet(hotelRows)
  wsHotels['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, wsHotels, 'Hotels')

  // ── Sheet 4: Passengers ───────────────────────────────────────────────────
  const paxRows: unknown[][] = [['Booking Ref', 'Name', 'Lead', 'Passport', 'Nationality']]
  for (const b of bookings) {
    for (const p of b.passengers) {
      paxRows.push([b.bookingRef, p.name, p.isLead ? 'Yes' : '', p.passport ?? '', p.nationality ?? ''])
    }
  }
  const wsPax = XLSX.utils.aoa_to_sheet(paxRows)
  wsPax['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 5 }, { wch: 16 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, wsPax, 'Passengers')

  // ── Write to buffer ───────────────────────────────────────────────────────
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const body = new Uint8Array(buf)

  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const filename = `bookings-export-${dateStr}.xlsx`

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
