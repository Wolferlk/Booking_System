/**
 * Shared query builder for the Tickets & Vouchers screen and its reports.
 *
 * The list, the tab counts and the CSV/summary report all have to answer the
 * same question — "which tickets is this person asking about?" — so the answer
 * is built once, here, and the three callers differ only in what they do with
 * the rows afterwards. A filter added here reaches the report for free, and a
 * report can never disagree with the list it was exported from.
 *
 * Everything in this file is read-only: it produces Prisma `where` objects and
 * never writes.
 */
import { countryScope } from '@/lib/country-detection'
import type { OperationCountry, PNLCategory, Prisma } from '@prisma/client'

const PNL_CATEGORIES = [
  'HOTEL', 'TICKETS', 'GUIDES', 'MEALS', 'CRUISE',
  'WATER', 'TRANSPORT', 'TAX_FEES', 'FLIGHT_TICKETS', 'OTHER',
] as const

/** The status tabs across the top of the list. */
export type TicketStatusFilter =
  | 'all'
  | 'pending_activation'
  | 'active'
  | 'purchased'
  | 'issued'
  | 'not_issued'
  | 'awaiting_approval'

export type TicketSortKey =
  | 'created_desc' | 'created_asc'
  | 'arrival_asc'  | 'arrival_desc'
  | 'booking_created_desc' | 'booking_created_asc'
  | 'purchased_desc'
  | 'cost_desc'    | 'cost_asc'
  | 'type_asc'

export interface TicketFilters {
  q: string
  categories: string[]
  status: TicketStatusFilter
  /** Booking arrival date window — "which tickets are for travel in this period". */
  arrivalFrom: Date | null
  arrivalTo: Date | null
  /** Booking creation window — "which tickets belong to files opened in this period". */
  bookingCreatedFrom: Date | null
  bookingCreatedTo: Date | null
  /** Ticket row creation window. */
  ticketCreatedFrom: Date | null
  ticketCreatedTo: Date | null
  /** Purchase window — when the ticket was actually bought. */
  purchasedFrom: Date | null
  purchasedTo: Date | null
  bookingRef: string
  agent: string
  supplier: string
  portal: string
  approval: string
  /** Only rows that do / do not have an uploaded ticket file. */
  hasFile: 'any' | 'yes' | 'no'
  currency: string
  sort: TicketSortKey
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse a date box. A bare `YYYY-MM-DD` is read as a whole local day, so a
 * range of 08 Sep → 08 Sep returns that day's tickets rather than nothing:
 * `end` is pushed to the last millisecond of the day it names.
 */
function parseDate(value: string | null, end = false): Date | null {
  if (!value) return null
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0)
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const SORTS: TicketSortKey[] = [
  'created_desc', 'created_asc', 'arrival_asc', 'arrival_desc',
  'booking_created_desc', 'booking_created_asc', 'purchased_desc',
  'cost_desc', 'cost_asc', 'type_asc',
]

const STATUSES: TicketStatusFilter[] = [
  'all', 'pending_activation', 'active', 'purchased',
  'issued', 'not_issued', 'awaiting_approval',
]

export function parseTicketFilters(searchParams: URLSearchParams): TicketFilters {
  const str = (k: string) => (searchParams.get(k) ?? '').trim()
  const status = str('status') as TicketStatusFilter
  const sort = str('sort') as TicketSortKey
  const hasFile = str('hasFile')

  return {
    q: str('q'),
    categories: str('category').split(',').map(c => c.trim()).filter(Boolean),
    status: STATUSES.includes(status) ? status : 'all',
    arrivalFrom:        parseDate(str('arrivalFrom') || null),
    arrivalTo:          parseDate(str('arrivalTo') || null, true),
    bookingCreatedFrom: parseDate(str('bookingCreatedFrom') || null),
    bookingCreatedTo:   parseDate(str('bookingCreatedTo') || null, true),
    ticketCreatedFrom:  parseDate(str('ticketCreatedFrom') || null),
    ticketCreatedTo:    parseDate(str('ticketCreatedTo') || null, true),
    purchasedFrom:      parseDate(str('purchasedFrom') || null),
    purchasedTo:        parseDate(str('purchasedTo') || null, true),
    bookingRef: str('bookingRef'),
    agent:      str('agent'),
    supplier:   str('supplier'),
    portal:     str('portal'),
    approval:   str('approval'),
    hasFile: hasFile === 'yes' || hasFile === 'no' ? hasFile : 'any',
    currency: str('currency'),
    sort: SORTS.includes(sort) ? sort : 'created_desc',
  }
}

/** True when the caller asked for nothing in particular. */
export function isEmptyFilter(f: TicketFilters): boolean {
  return !f.q && !f.categories.length && f.status === 'all' && f.hasFile === 'any' &&
    !f.arrivalFrom && !f.arrivalTo && !f.bookingCreatedFrom && !f.bookingCreatedTo &&
    !f.ticketCreatedFrom && !f.ticketCreatedTo && !f.purchasedFrom && !f.purchasedTo &&
    !f.bookingRef && !f.agent && !f.supplier && !f.portal && !f.approval && !f.currency
}

/**
 * The `where` for everything except the status tab.
 *
 * Kept separate so the tab counts can be computed against the *rest* of the
 * filters — a count next to "Purchased" that ignored the date range the user
 * just typed would be a number for a list they are not looking at.
 */
export function buildTicketWhere(
  f: TicketFilters,
  effectiveCountry: OperationCountry | null,
): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {}
  const and: Prisma.TicketWhereInput[] = []

  // ── ticket-level windows ────────────────────────────────────────────────
  if (f.ticketCreatedFrom || f.ticketCreatedTo) {
    where.createdAt = {
      ...(f.ticketCreatedFrom && { gte: f.ticketCreatedFrom }),
      ...(f.ticketCreatedTo && { lte: f.ticketCreatedTo }),
    }
  }
  if (f.purchasedFrom || f.purchasedTo) {
    where.purchasedAt = {
      ...(f.purchasedFrom && { gte: f.purchasedFrom }),
      ...(f.purchasedTo && { lte: f.purchasedTo }),
    }
  }

  if (f.categories.length) {
    // `category` lives on the ticket for rows entered by hand and on the P&L
    // line for rows generated from a costing sheet, and the list reads whichever
    // is set — so the filter has to look in both places or it silently drops
    // half the matches. OTHER is the fallback the list shows when neither says
    // anything, so it also has to match rows where both are null.
    const wantsOther = f.categories.includes('OTHER')
    // `pnlLine.category` is the PNLCategory enum; the hand-entered ticket column
    // is free text, so only the values the enum knows can go to the relation.
    const enumCats = f.categories.filter(
      (c): c is PNLCategory => (PNL_CATEGORIES as readonly string[]).includes(c),
    )
    const or: Prisma.TicketWhereInput[] = [{ category: { in: f.categories } }]
    if (enumCats.length) or.push({ pnlLine: { category: { in: enumCats } } })
    // A row with neither column set is drawn as OTHER, so OTHER has to match it.
    if (wantsOther) or.push({ AND: [{ category: null }, { pnlLineId: null }] })
    and.push({ OR: or })
  }

  if (f.supplier) where.supplier = { contains: f.supplier }
  if (f.portal)   where.portalName = { contains: f.portal }
  if (f.currency) where.currency = f.currency

  if (f.approval) {
    // "none" means never submitted to Accounts — a null column, not a value.
    where.approvalStatus = f.approval === 'none' ? null : f.approval
  }

  if (f.hasFile === 'yes') and.push({ NOT: { fileUrl: null } })
  if (f.hasFile === 'no')  and.push({ fileUrl: null })

  // ── booking-level windows ───────────────────────────────────────────────
  const booking: Prisma.BookingWhereInput = {}
  if (effectiveCountry) {
    const scope = countryScope(effectiveCountry)
    if (scope) booking.operationCountry = { in: scope }
  }
  if (f.arrivalFrom || f.arrivalTo) {
    booking.arrivalDate = {
      ...(f.arrivalFrom && { gte: f.arrivalFrom }),
      ...(f.arrivalTo && { lte: f.arrivalTo }),
    }
  }
  if (f.bookingCreatedFrom || f.bookingCreatedTo) {
    booking.createdAt = {
      ...(f.bookingCreatedFrom && { gte: f.bookingCreatedFrom }),
      ...(f.bookingCreatedTo && { lte: f.bookingCreatedTo }),
    }
  }
  if (f.bookingRef) booking.bookingRef = { contains: f.bookingRef }
  if (f.agent)      booking.agent = { contains: f.agent }
  if (Object.keys(booking).length) where.booking = booking

  // ── free-text search ────────────────────────────────────────────────────
  // Searching a booking reference here is the "when searching a particular
  // booking, include its tickets" case: one ref typed in the box brings that
  // file's tickets back regardless of which other columns happen to match.
  if (f.q) {
    and.push({
      OR: [
        { type:       { contains: f.q } },
        { supplier:   { contains: f.q } },
        { reference:  { contains: f.q } },
        { notes:      { contains: f.q } },
        { portalName: { contains: f.q } },
        { portalRef:  { contains: f.q } },
        { booking: { bookingRef: { contains: f.q } } },
        { booking: { agent:      { contains: f.q } } },
        { booking: { dealName:   { contains: f.q } } },
      ],
    })
  }

  if (and.length) where.AND = and
  return where
}

/** Narrow a base `where` to one status tab. */
export function applyStatusFilter(
  where: Prisma.TicketWhereInput,
  status: TicketStatusFilter,
): Prisma.TicketWhereInput {
  const clause = STATUS_CLAUSE[status]
  if (!clause) return where
  return { AND: [where, clause] }
}

/**
 * What each tab means. `issued` is "the ticket document is on file" — the
 * upload is what the ground team actually hands the guest — and `not_issued`
 * is its complement over tickets that have been paid for and so are owed one.
 */
export const STATUS_CLAUSE: Record<TicketStatusFilter, Prisma.TicketWhereInput | null> = {
  all: null,
  pending_activation: { activated: false },
  active:             { activated: true, status: 'DRAFT' },
  purchased:          { status: { in: ['PURCHASED', 'PAID'] } },
  issued:             { NOT: { fileUrl: null } },
  not_issued:         { fileUrl: null, status: { in: ['PURCHASED', 'PAID'] } },
  awaiting_approval:  { approvalStatus: 'pending' },
}

export function buildOrderBy(sort: TicketSortKey): Prisma.TicketOrderByWithRelationInput {
  switch (sort) {
    case 'created_asc':          return { createdAt: 'asc' }
    case 'arrival_asc':          return { booking: { arrivalDate: 'asc' } }
    case 'arrival_desc':         return { booking: { arrivalDate: 'desc' } }
    case 'booking_created_asc':  return { booking: { createdAt: 'asc' } }
    case 'booking_created_desc': return { booking: { createdAt: 'desc' } }
    case 'purchased_desc':       return { purchasedAt: 'desc' }
    case 'cost_desc':            return { totalCost: 'desc' }
    case 'cost_asc':             return { totalCost: 'asc' }
    case 'type_asc':             return { type: 'asc' }
    default:                     return { createdAt: 'desc' }
  }
}

/** Everything the list row and the CSV need, in one shape. */
export const TICKET_LIST_INCLUDE = {
  booking: {
    select: {
      bookingRef: true, arrivalDate: true, departureDate: true,
      agent: true, createdAt: true, operationCountry: true, status: true,
    },
  },
  agendaItem: { select: { date: true, location: true, toPoint: true } },
  pnlLine: {
    select: {
      activity: true, paymentStatus: true, paymentRefNumber: true, category: true,
      mmtRate: true, sicRate: true, pvtRatePP: true,
      adEntrance: true, chEntrance: true, otherRate: true,
      pnl: { select: { paxAdults: true, paxChildren: true } },
    },
  },
} as const
