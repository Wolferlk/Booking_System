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
import { emptyCalls, type BookingCalls } from '@/lib/daily-update-calls'
import { emptyFeedbackForm, type FeedbackFormCell } from '@/lib/daily-update-feedback'
import {
  fetchCallApprovalsForBookings, fetchCallsForBookings, fetchFeedbackFormsForBookings,
} from '@/lib/daily-update-calls-data'
import {
  emptyCallApproval, isCallApprovalFilter, matchesCallApprovalFilter,
  type CallApprovalCell, type CallApprovalFilter,
} from '@/lib/daily-update-approval'
import { bookingSourceOf, bookingSourceWhere, type BookingSource } from '@/lib/booking-source'
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

/**
 * Sales channel the sheet is showing.
 *
 * `B2B` is the default rather than `ALL` because the sheet is the agent desk's
 * morning read: a B2C store order has no agent to chase and would otherwise
 * pad every count. The channel is derived from `Booking.agent`, so this filter
 * needs no column of its own — see `booking-source.ts`.
 */
export type SourceFilter = 'ALL' | BookingSource

const SOURCE_FILTERS: SourceFilter[] = ['ALL', 'B2B', 'B2C']

export const SOURCE_LABELS: Record<SourceFilter, string> = {
  ALL: 'All bookings',
  B2B: 'B2B (agent bookings)',
  B2C: 'B2C (Aahaas store)',
}

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
  /** B2B agent booking or a B2C storefront order. */
  source:           BookingSource
  /** Pre-trip / on-ground / post-tour calls, from the bot and from staff. */
  calls:            BookingCalls
  /** The digital Guest Feedback Form: the submission, or when it was sent. */
  feedbackForm:     FeedbackFormCell
  /** WhatsApp permission for the AI bot to call this guest. */
  callApproval:     CallApprovalCell
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
  source:       SourceFilter
  includeCancelled: boolean
  /**
   * Which WhatsApp call-approval bucket the sheet is showing. Applied to the
   * rows rather than to SQL — the state is resolved from the approval ledger
   * and the call log, neither of which is a column on `Booking`.
   */
  callApproval: CallApprovalFilter
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
    // Absent means the default view, which is B2B — not "everything".
    source: (SOURCE_FILTERS as string[]).includes(sp.get('source') ?? '')
      ? sp.get('source') as SourceFilter
      : 'B2B',
    includeCancelled: sp.get('includeCancelled') === '1',
    callApproval: isCallApprovalFilter(sp.get('callApproval')) ? sp.get('callApproval') as CallApprovalFilter : 'all',
    sortBy,
    sortDir: sp.get('sortDir') === 'desc' ? 'desc' : 'asc',
  }
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
/**
 * Everything the sheet filters on *except* the date window.
 *
 * Kept separate so the "booked today" headline can reuse the identical country,
 * agent, search and cancellation rules while asking a different date question —
 * otherwise that number would quietly ignore the filters the user has set.
 */
function nonDateClauses(q: DailyUpdateQuery, scope: SessionScope): Prisma.BookingWhereInput[] {
  const and: Prisma.BookingWhereInput[] = []

  const country = countryClause(scope, q.country)
  if (country) and.push(country)

  if (q.agent) and.push({ agent: q.agent })

  const source = bookingSourceWhere(q.source === 'ALL' ? null : q.source)
  if (source) and.push(source as Prisma.BookingWhereInput)

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

  return and
}

export function buildDailyUpdateWhere(
  q: DailyUpdateQuery,
  scope: SessionScope,
  now = new Date(),
): Prisma.BookingWhereInput {
  // The sheet is a window on one date column and nothing else — a booking is on
  // it because it falls in the window, never because of when it was sold. To
  // see today's intake, switch the window's date column to Created.
  const { start, end } = resolveRange(q, now)
  const and: Prisma.BookingWhereInput[] = [
    ...nonDateClauses(q, scope),
    { [q.dateField]: { gte: start, lte: end } },
  ]

  return { AND: and }
}

/**
 * How many bookings were sold today, whatever window the sheet is showing.
 *
 * The table itself is strictly the date window, so this is the one number that
 * deliberately looks outside it: "what came in today" is the other half of a
 * morning update, and the headline is a link into the Created / Today view
 * rather than a second band of rows.
 */
export async function countCreatedToday(
  q: DailyUpdateQuery,
  scope: SessionScope,
  now = new Date(),
): Promise<number> {
  return prisma.booking.count({
    where: {
      AND: [
        ...nonDateClauses(q, scope),
        { createdAt: { gte: startOfDay(now), lte: endOfDay(now) } },
      ],
    },
  })
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

  // One batched load for the whole page rather than a handful of queries per row.
  const keys = bookings.map(b => ({ id: b.id, bookingRef: b.bookingRef }))
  const [calls, feedbackForms, callApprovals] = await Promise.all([
    fetchCallsForBookings(keys),
    fetchFeedbackFormsForBookings(keys),
    fetchCallApprovalsForBookings(
      bookings.map(b => ({
        id: b.id, bookingRef: b.bookingRef,
        guestWhatsapp: b.contactWhatsapp, guestPhone: b.contactPhone,
      })),
    ),
  ])

  const todayStart = startOfDay(now).getTime()
  const todayEnd   = endOfDay(now).getTime()

  const shaped = bookings.map((b) => {
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
      source:           bookingSourceOf(b.agent),
      calls:            calls[b.id] ?? emptyCalls(),
      feedbackForm:     feedbackForms[b.id] ?? emptyFeedbackForm(),
      callApproval:     callApprovals[b.id] ?? emptyCallApproval(),
    }
  })

  // Approval is not a booking column — it is resolved above from the ledger and
  // the call log — so this bucket filter has to be applied to the shaped rows.
  // It runs here rather than in the screen so the counts, the row numbers and
  // all three downloads keep showing the identical set.
  return q.callApproval === 'all'
    ? shaped
    : shaped.filter(r => matchesCallApprovalFilter(r.callApproval, q.callApproval))
}

/**
 * Sheet order: the window's date column, then booking ref as a stable tiebreak.
 *
 * Applied here rather than left to SQL alone so the screen and both downloads
 * land on the identical order — a row referred to by its number in a handover
 * has to mean the same thing in all three.
 */
export function sortDailyUpdateRows(rows: DailyUpdateRow[], q: DailyUpdateQuery): DailyUpdateRow[] {
  const dir = q.sortDir === 'desc' ? -1 : 1
  const key = (r: DailyUpdateRow) => new Date(r[q.sortBy]).getTime()
  return [...rows].sort((a, b) => {
    const delta = key(a) - key(b)
    if (delta !== 0) return delta * dir
    return a.bookingRef.localeCompare(b.bookingRef)
  })
}

export type DailyUpdateStats = {
  total:         number
  /**
   * Bookings sold today. Everything else here is derived from the rows on the
   * sheet; this one is counted across the whole scope, because the window the
   * sheet is showing has nothing to do with what came in this morning. Callers
   * that have that count pass it in — the fallback keeps the builders usable
   * on their own.
   */
  bookedToday:   number
  arrivingToday: number
  onGround:      number
  missingIds:    number
  totalPax:      number
}

/** Headline counts for the sheet's summary strip and the download headers. */
export function summarise(
  rows: DailyUpdateRow[],
  bookedToday?: number,
): DailyUpdateStats {
  const now = new Date()
  return {
    total:         rows.length,
    bookedToday:   bookedToday ?? rows.filter(r => r.createdToday).length,
    arrivingToday: rows.filter(r => r.daysToArrival === 0).length,
    onGround:      rows.filter(r => r.daysToArrival < 0 && new Date(r.departureDate) >= now).length,
    missingIds:    rows.filter(r => !r.isNumber || !r.cntlNumber).length,
    totalPax:      rows.reduce((s, r) => s + r.totalPax, 0),
  }
}
