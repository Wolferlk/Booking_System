/**
 * Daily-update sheet — the one flat list the desk reads each morning.
 *
 * Every other operational page in this system is organised around a *stage*:
 * the review queue, the ops board, the movement chart. This one is organised
 * around the calendar. It answers a different question — "what is landing in
 * the next ten days, and what came in today?" — and it answers it as a sheet
 * somebody can mail out, print, or paste into a handover.
 *
 * The query is shared verbatim by the screen and by both downloads, so an
 * exported sheet always contains exactly the rows the screen was showing.
 * Everything here is read-only; the single write the feature makes (filling a
 * missing IS / CNTL number) goes through the existing booking PUT route so it
 * inherits that route's permission and country checks rather than inventing a
 * second, weaker path to the same columns.
 */

import { prisma } from '@/lib/prisma'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope } from '@/lib/country-detection'
import type { Prisma, UserRole } from '@prisma/client'

/** Roles that may read the sheet. Read-only, so this is every internal desk. */
export const DAILY_UPDATE_ROLES: UserRole[] = [
  'BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'AC_USER',
  'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

/** Roles that may fill in a missing IS / CNTL number from the sheet. */
export const DAILY_UPDATE_EDIT_ROLES: UserRole[] = [
  'BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

/** Which date column the day-window filter is measured against. */
export type DateField = 'arrivalDate' | 'departureDate' | 'createdAt' | 'updatedAt'

const DATE_FIELDS: DateField[] = ['arrivalDate', 'departureDate', 'createdAt', 'updatedAt']

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  arrivalDate:   'Arrival date',
  departureDate: 'Departure date',
  createdAt:     'Booking created date',
  updatedAt:     'Last updated date',
}

export type DailyUpdateRow = {
  id:               string
  bookingRef:       string
  isNumber:         string | null
  cntlNumber:       string | null
  agentBookingId:   string | null
  operationCountry: string | null
  status:           string
  /** Travel window. */
  arrivalDate:      string
  departureDate:    string
  nights:           number
  createdAt:        string
  updatedAt:        string
  /** Whole days from today to arrival — negative once the guest has landed. */
  daysToArrival:    number
  guestName:        string | null
  guestPhone:       string | null
  guestEmail:       string | null
  guestWhatsapp:    string | null
  agent:            string | null
  agentPhone:       string | null
  agentEmail:       string | null
  agentWhatsapp:    string | null
  fileHandler:      string | null
  paxAdults:        number
  paxChildren:      number
  paxInfants:       number
  totalPax:         number
  /** Landed in the system today — these are pinned to the top of the sheet. */
  createdToday:     boolean
  /** Touched since it was created, so the row is worth re-reading. */
  amended:          boolean
  hotelOnly:        boolean
  cancelled:        boolean
}

export type DailyUpdateQuery = {
  dateField:    DateField
  /** Size of the forward window in days. 0 means "today only". */
  days:         number
  from:         Date | null
  to:           Date | null
  agent:        string
  search:       string
  country:      string
  /** Bookings created today are carried regardless of the date window. */
  includeToday: boolean
  includeCancelled: boolean
  sortBy:       DateField
  sortDir:      'asc' | 'desc'
}

export type SessionScope = {
  role:        UserRole
  country?:    string
  countries?:  string[]
}

const DAY_MS = 86_400_000

/** Local midnight at the start of `d`. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** The instant just before the next local midnight after `d`. */
export function endOfDay(d: Date): Date {
  const s = startOfDay(d)
  return new Date(s.getTime() + DAY_MS - 1)
}

/** Reads the sheet's filters off a query string, clamping anything hostile. */
export function parseDailyUpdateQuery(sp: URLSearchParams): DailyUpdateQuery {
  const rawField = sp.get('dateField') as DateField | null
  const dateField: DateField = rawField && DATE_FIELDS.includes(rawField) ? rawField : 'arrivalDate'

  const rawSort = sp.get('sortBy') as DateField | null
  const sortBy: DateField = rawSort && DATE_FIELDS.includes(rawSort) ? rawSort : dateField

  // `Number(null)` is 0, not NaN, so an absent param has to be checked for
  // explicitly — otherwise the default ten-day window collapses to today.
  // 366 rather than "unbounded": the sheet is a day-window view, and an
  // accidental all-time request would drag the whole booking table into a PDF.
  const rawDays = sp.get('days')
  const parsedDays = rawDays === null || rawDays.trim() === '' ? NaN : Number(rawDays)
  const days = Number.isFinite(parsedDays)
    ? Math.min(Math.max(Math.trunc(parsedDays), 0), 366)
    : 10

  const parseDate = (v: string | null): Date | null => {
    if (!v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }

  return {
    dateField,
    days,
    from:  parseDate(sp.get('from')),
    to:    parseDate(sp.get('to')),
    agent: (sp.get('agent') ?? '').trim(),
    search: (sp.get('search') ?? '').trim(),
    country: (sp.get('country') ?? '').trim(),
    // The "created today on top" behaviour is the default and can be switched
    // off, but it never applies when an explicit date range is being asked for.
    includeToday: sp.get('includeToday') !== '0',
    includeCancelled: sp.get('includeCancelled') === '1',
    sortBy,
    sortDir: sp.get('sortDir') === 'desc' ? 'desc' : 'asc',
  }
}

/**
 * Whether today's intake is carried and pinned above the window.
 *
 * An explicit from/to range means the caller asked for a specific span and
 * nothing else, so the "plus everything created today" clause is dropped —
 * and because the sort and the section headings read this same helper, they
 * cannot end up pinning rows the query never widened for.
 */
export function pinsToday(q: DailyUpdateQuery): boolean {
  return q.includeToday && !q.from && !q.to
}

/** The window the filters actually resolve to, for labelling the sheet. */
export function resolveRange(q: DailyUpdateQuery, now = new Date()): { start: Date; end: Date } {
  if (q.from || q.to) {
    const start = q.from ? startOfDay(q.from) : startOfDay(now)
    const end   = q.to   ? endOfDay(q.to)     : endOfDay(new Date(start.getTime() + q.days * DAY_MS))
    return { start, end }
  }
  const start = startOfDay(now)
  const end   = endOfDay(new Date(start.getTime() + q.days * DAY_MS))
  return { start, end }
}

/**
 * Country scoping, identical in shape to every other list route: a user only
 * ever sees their own country, and only the two admin roles may override it.
 */
export function countryClause(scope: SessionScope, override: string): Prisma.BookingWhereInput | null {
  if (!canSeeAllCountries(scope.role, (scope.country ?? 'ALL') as never)) {
    const allowed = userCountryScope(scope.country, scope.countries)
    return allowed ? { operationCountry: { in: allowed as never } } : null
  }
  if (!override || override === 'ALL') return null
  const expanded = countryScope(override)
  return expanded && expanded.length > 1
    ? { operationCountry: { in: expanded as never } }
    : { operationCountry: override as never }
}

/** Builds the Prisma WHERE the screen and both downloads all share. */
export function buildDailyUpdateWhere(
  q: DailyUpdateQuery,
  scope: SessionScope,
  now = new Date(),
): Prisma.BookingWhereInput {
  const and: Prisma.BookingWhereInput[] = []

  const country = countryClause(scope, q.country)
  if (country) and.push(country)

  const { start, end } = resolveRange(q, now)
  const windowClause: Prisma.BookingWhereInput = { [q.dateField]: { gte: start, lte: end } }

  // Default sheet = "everything arriving in the window, plus anything that came
  // in today". Today's intake is the other half of a morning update: a file
  // sold this morning for travel in March is news even though it is nowhere
  // near the arrival window.
  if (pinsToday(q)) {
    and.push({ OR: [windowClause, { createdAt: { gte: startOfDay(now), lte: endOfDay(now) } }] })
  } else {
    and.push(windowClause)
  }

  if (q.agent) and.push({ agent: q.agent })

  if (q.search) {
    and.push({
      OR: [
        { bookingRef:     { contains: q.search } },
        { isNumber:       { contains: q.search } },
        { cntlNumber:     { contains: q.search } },
        { agentBookingId: { contains: q.search } },
        { agent:          { contains: q.search } },
        { fileHandler:    { contains: q.search } },
        { contactPhone:   { contains: q.search } },
        { passengers: { some: { name: { contains: q.search } } } },
      ],
    })
  }

  if (!q.includeCancelled) and.push({ status: { notIn: ['CANCELLED'] } })

  return and.length > 0 ? { AND: and } : {}
}

const ROW_SELECT = {
  id:               true,
  bookingRef:       true,
  isNumber:         true,
  cntlNumber:       true,
  agentBookingId:   true,
  operationCountry: true,
  status:           true,
  arrivalDate:      true,
  departureDate:    true,
  createdAt:        true,
  updatedAt:        true,
  agent:            true,
  agentPhone:       true,
  agentEmail:       true,
  agentWhatsapp:    true,
  fileHandler:      true,
  contactPhone:     true,
  contactEmail:     true,
  contactWhatsapp:  true,
  paxAdults:        true,
  paxChildren:      true,
  paxInfants:       true,
  hotelOnly:        true,
  passengers: { select: { name: true, isLead: true }, orderBy: { isLead: 'desc' } },
} satisfies Prisma.BookingSelect

/**
 * The sheet, ready to render. Capped rather than paged: a day-window view is
 * meant to be short, and a cap keeps a mis-set window from turning into a
 * multi-thousand-row PDF render on a Lambda.
 */
export async function fetchDailyUpdateRows(
  q: DailyUpdateQuery,
  scope: SessionScope,
  limit = 1500,
  now = new Date(),
): Promise<DailyUpdateRow[]> {
  const bookings = await prisma.booking.findMany({
    where: buildDailyUpdateWhere(q, scope, now),
    select: ROW_SELECT,
    orderBy: { [q.sortBy]: q.sortDir },
    take: limit,
  })

  const todayStart = startOfDay(now).getTime()
  const todayEnd   = endOfDay(now).getTime()

  return bookings.map((b) => {
    const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0] ?? null
    const arrival = b.arrivalDate
    const created = b.createdAt.getTime()
    const nights = Math.max(
      0,
      Math.round((startOfDay(b.departureDate).getTime() - startOfDay(arrival).getTime()) / DAY_MS),
    )
    return {
      id:               b.id,
      bookingRef:       b.bookingRef,
      isNumber:         b.isNumber,
      cntlNumber:       b.cntlNumber,
      agentBookingId:   b.agentBookingId,
      operationCountry: b.operationCountry,
      status:           String(b.status),
      arrivalDate:      arrival.toISOString(),
      departureDate:    b.departureDate.toISOString(),
      nights,
      createdAt:        b.createdAt.toISOString(),
      updatedAt:        b.updatedAt.toISOString(),
      daysToArrival:    Math.round((startOfDay(arrival).getTime() - todayStart) / DAY_MS),
      guestName:        lead?.name ?? null,
      guestPhone:       b.contactPhone,
      guestEmail:       b.contactEmail,
      guestWhatsapp:    b.contactWhatsapp,
      agent:            b.agent,
      agentPhone:       b.agentPhone,
      agentEmail:       b.agentEmail,
      agentWhatsapp:    b.agentWhatsapp,
      fileHandler:      b.fileHandler,
      paxAdults:        b.paxAdults,
      paxChildren:      b.paxChildren,
      paxInfants:       b.paxInfants,
      totalPax:         b.paxAdults + b.paxChildren + b.paxInfants,
      createdToday:     created >= todayStart && created <= todayEnd,
      // updatedAt is bumped by `@updatedAt` on every write, so a second-level
      // difference is just the create itself — only a real later edit counts.
      amended:          b.updatedAt.getTime() - created > 60_000,
      hotelOnly:        b.hotelOnly,
      cancelled:        String(b.status) === 'CANCELLED' || String(b.status) === 'PENDING_CANCELLATION',
    }
  })
}

/**
 * Sheet order: today's intake first, then the travel window in date order.
 *
 * Done here rather than in SQL because "created today" is a property of the
 * row relative to *now*, and both downloads must land on the identical order
 * the screen showed.
 */
export function sortDailyUpdateRows(rows: DailyUpdateRow[], q: DailyUpdateQuery): DailyUpdateRow[] {
  const dir = q.sortDir === 'desc' ? -1 : 1
  const pin = pinsToday(q)
  const key = (r: DailyUpdateRow) => new Date(r[q.sortBy]).getTime()
  return [...rows].sort((a, b) => {
    if (pin && a.createdToday !== b.createdToday) return a.createdToday ? -1 : 1
    const delta = key(a) - key(b)
    if (delta !== 0) return delta * dir
    return a.bookingRef.localeCompare(b.bookingRef)
  })
}

/** Headline counts for the sheet's summary strip and the download headers. */
export function summarise(rows: DailyUpdateRow[]) {
  return {
    total:        rows.length,
    createdToday: rows.filter(r => r.createdToday).length,
    arrivingToday: rows.filter(r => r.daysToArrival === 0).length,
    onGround:     rows.filter(r => r.daysToArrival < 0 && new Date(r.departureDate) >= new Date()).length,
    missingIds:   rows.filter(r => !r.isNumber || !r.cntlNumber).length,
    totalPax:     rows.reduce((s, r) => s + r.totalPax, 0),
  }
}
