/**
 * Reservation Team — server read layer.
 *
 * Server-only: importing this pulls in Prisma. The shapes and the arithmetic
 * live in `reservation-shared.ts` so the browser can use them too, and are
 * re-exported below so server code only ever needs this import.
 *
 * Two things here deserve a note.
 *
 * 1. The **request inbox is derived on read**, not backfilled. It is the set of
 *    accommodation lines on live bookings that have no reservation row yet.
 *    Nothing is written until somebody actually starts work, exactly the way
 *    the D-10 pre-checking queue materialises its rows lazily. That means the
 *    module can be switched on against a live database with 40 000 bookings and
 *    create precisely zero rows.
 *
 * 2. Links to bookings, accommodations, hotel profiles and P&L lines are all
 *    **soft** — resolved on every read, never enforced by a foreign key. An
 *    amendment rewrites a booking's accommodation rows wholesale, and a
 *    confirmed supplier commitment must survive that.
 */
import type { OperationCountry, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { normalizeHotelName } from './hotel-match'
import { isOwnArrangement } from './own-arrangement'
import {
  buildReservationKey, classifyDeadline, daysBetween, hoursSince,
  nightsBetween, stayTotal, toNumber, TERMINAL_STATUSES, SECURED_STATUSES,
  type ReservationStatusValue, type Urgency,
} from './reservation-shared'

export * from './reservation-shared'

/**
 * Hotel "names" that are not a property: the guest's own booking, or a
 * placeholder for one not yet chosen. Neither can be quoted or confirmed.
 */
const NOT_A_PROPERTY = /^\s*(own\s*arrangement|own|tba|tbc|n\/?a|to\s*be\s*(advised|confirmed)|-)\s*$/i

/** How long a hotel may stay silent before the board chases it. */
export const HOTEL_SILENCE_HOURS = 24
/** How close an option release has to be before it becomes the top lane. */
export const OPTION_RELEASE_WARN_HOURS = 48
/** Payment lead time that puts a stay on the board. */
export const PAYMENT_DUE_WARN_DAYS = 7
/** Days after confirmation by which a proforma is expected. */
export const PROFORMA_DUE_DAYS = 14

type Countries = string[] | null

/** Country filter fragment, or an empty object when the user sees everything. */
function countryWhere(countries: Countries): Prisma.HotelReservationWhereInput {
  if (!countries || countries.length === 0) return {}
  return { operationCountry: { in: countries as OperationCountry[] } }
}

// ─── Request inbox ───────────────────────────────────────────────────────────

export interface InboxStay {
  /** Deterministic — the reservation row will take this key when created. */
  reservationKey: string
  bookingRef: string
  bookingId: string
  accommodationId: string
  operationCountry: OperationCountry | null
  agent: string | null
  hotelName: string
  city: string | null
  checkIn: string
  checkOut: string
  nights: number
  roomType: string | null
  mealType: string | null
  adults: number
  children: number
  /** Days from today to check-in. Negative once the stay is in the past. */
  daysToCheckIn: number
  urgency: Urgency
  ownArrangement: boolean
  hotelProfileId: string | null
  /** The P&L HOTEL line this stay is budgeted against, when one matched. */
  budgetLineId: string | null
  budgetAmount: number | null
}

interface InboxOptions {
  countries: Countries
  /** Ignore stays whose check-in is further out than this. */
  horizonDays?: number
  /** Include stays already in the past. Off by default. */
  includePast?: boolean
  search?: string
  limit?: number
}

/**
 * Accommodation lines with no reservation row yet.
 *
 * Own-arrangement stays are excluded: we hold no commitment with the property,
 * so there is nothing for this team to negotiate — the same rule pre-checking
 * applies.
 */
export async function getRequestInbox(opts: InboxOptions): Promise<InboxStay[]> {
  const horizon = opts.horizonDays ?? 365
  const today = new Date()
  const from = opts.includePast ? new Date(0) : new Date(today.getTime() - 2 * 86_400_000)
  const to = new Date(today.getTime() + horizon * 86_400_000)

  const bookingWhere: Prisma.BookingWhereInput = {
    status: { notIn: ['CANCELLED', 'COMPLETED'] },
    ...(opts.countries && opts.countries.length
      ? { operationCountry: { in: opts.countries as OperationCountry[] } }
      : {}),
    ...(opts.search
      ? {
          OR: [
            { bookingRef: { contains: opts.search } },
            { agent: { contains: opts.search } },
            { accommodations: { some: { hotel: { contains: opts.search } } } },
          ],
        }
      : {}),
  }

  const bookings = await prisma.booking.findMany({
    where: {
      ...bookingWhere,
      accommodations: { some: { checkIn: { gte: from, lte: to } } },
    },
    select: {
      id: true, bookingRef: true, agent: true, operationCountry: true,
      accommodations: {
        where: { checkIn: { gte: from, lte: to } },
        select: {
          id: true, hotel: true, city: true, checkIn: true, checkOut: true,
          nights: true, roomType: true, mealType: true, ownArrangement: true,
        },
        orderBy: { checkIn: 'asc' },
      },
      paxAdults: true, paxChildren: true, paxInfants: true,
      pnl: {
        select: {
          lineItems: {
            where: { category: 'HOTEL' },
            select: { id: true, activity: true, mmtRate: true, sicRate: true, pvtRatePP: true, otherRate: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 400,
  })

  const refs = bookings.map(b => b.bookingRef)
  // One query for every reservation that already exists on these bookings —
  // the inbox is "what is left", so it is a set difference, not a per-row probe.
  const existing = refs.length
    ? await prisma.hotelReservation.findMany({
        where: { bookingRef: { in: refs } },
        select: { reservationKey: true },
      })
    : []
  const taken = new Set(existing.map(r => r.reservationKey))

  const profiles = await loadHotelProfileIndex()
  const out: InboxStay[] = []

  for (const b of bookings) {
    const adults = b.paxAdults
    const children = b.paxChildren

    for (const a of b.accommodations) {
      const key = buildReservationKey(b.bookingRef, a.hotel, a.checkIn)
      if (taken.has(key)) continue
      if (isOwnArrangement(a as unknown as Record<string, unknown>)) continue
      // Second guard, deliberately local to this queue. `isOwnArrangement`
      // stops consulting its text heuristics once `accommodations.ownArrangement`
      // is explicitly false, so a row the extractor flagged false while naming
      // the hotel "Own Arrangement" still reaches here. Pre-checking tolerates
      // that — an operator may still ring the property — but this desk cannot:
      // there is no supplier to negotiate a rate with, so the row is noise.
      if (NOT_A_PROPERTY.test(a.hotel ?? '')) continue

      const budget = matchBudgetLine(b.pnl?.lineItems ?? [], a.hotel)
      const days = daysBetween(new Date(), a.checkIn)

      out.push({
        reservationKey: key,
        bookingRef: b.bookingRef,
        bookingId: b.id,
        accommodationId: a.id,
        operationCountry: b.operationCountry,
        agent: b.agent,
        hotelName: a.hotel,
        city: a.city,
        checkIn: a.checkIn.toISOString(),
        checkOut: a.checkOut.toISOString(),
        nights: a.nights || nightsBetween(a.checkIn, a.checkOut),
        roomType: a.roomType,
        mealType: a.mealType,
        adults,
        children,
        daysToCheckIn: days,
        // A stay nobody has started is urgent by proximity alone.
        urgency: days < 0 ? 'overdue' : days <= 14 ? 'critical' : days <= 30 ? 'soon' : 'later',
        ownArrangement: false,
        hotelProfileId: profiles.get(normalizeHotelName(a.hotel)) ?? null,
        budgetLineId: budget?.id ?? null,
        budgetAmount: budget ? toNumber(budget.mmtRate) : null,
      })
    }
  }

  return out.sort((a, b) => a.daysToCheckIn - b.daysToCheckIn)
}

/** normalizedName → hotel profile id, for soft-linking a stay to a property. */
async function loadHotelProfileIndex(): Promise<Map<string, string>> {
  const rows = await prisma.hotelProfile.findMany({ select: { id: true, normalizedName: true } })
  return new Map(rows.map(r => [r.normalizedName, r.id]))
}

/**
 * Pick the P&L HOTEL line that belongs to a stay.
 *
 * Matching is on the hotel name appearing in the activity text — imperfect, and
 * deliberately so: a wrong guess is visible to the team as a budget they can
 * correct, whereas no guess at all means every stay starts with no budget and
 * the over-budget warning never fires.
 */
function matchBudgetLine<T extends { id: string; activity: string }>(
  lines: T[],
  hotelName: string,
): T | null {
  if (lines.length === 0) return null
  const target = normalizeHotelName(hotelName)
  if (!target) return null
  const exact = lines.find(l => normalizeHotelName(l.activity) === target)
  if (exact) return exact
  const token = target.split(/\s+/).filter(t => t.length > 3)[0]
  if (!token) return null
  return lines.find(l => normalizeHotelName(l.activity).includes(token)) ?? null
}

// ─── Reservation reads ───────────────────────────────────────────────────────

const RESERVATION_INCLUDE = {
  options: { orderBy: [{ selected: 'desc' }, { sortOrder: 'asc' }] },
  specialRequests: { orderBy: { requestedAt: 'asc' } },
  invoices: { orderBy: { createdAt: 'desc' } },
  creditNotes: { orderBy: { raisedAt: 'desc' } },
} satisfies Prisma.HotelReservationInclude

export type ReservationWithChildren = Prisma.HotelReservationGetPayload<{
  include: typeof RESERVATION_INCLUDE
}>

export interface ListFilters {
  countries: Countries
  status?: ReservationStatusValue[]
  bookingRef?: string
  hotelProfileId?: string
  assignedToEmail?: string
  search?: string
  /** Check-in window. */
  from?: Date
  to?: Date
  take?: number
  skip?: number
}

export async function listReservations(f: ListFilters) {
  const where: Prisma.HotelReservationWhereInput = {
    ...countryWhere(f.countries),
    ...(f.status?.length ? { status: { in: f.status } } : {}),
    ...(f.bookingRef ? { bookingRef: f.bookingRef.toUpperCase() } : {}),
    ...(f.hotelProfileId ? { hotelProfileId: f.hotelProfileId } : {}),
    ...(f.assignedToEmail ? { assignedToEmail: f.assignedToEmail } : {}),
    ...(f.from || f.to ? { checkIn: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.search
      ? {
          OR: [
            { bookingRef: { contains: f.search } },
            { hotelName: { contains: f.search } },
            { confirmationNumber: { contains: f.search } },
            { leadGuestName: { contains: f.search } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.hotelReservation.findMany({
      where,
      include: RESERVATION_INCLUDE,
      orderBy: [{ checkIn: 'asc' }],
      take: f.take ?? 100,
      skip: f.skip ?? 0,
    }),
    prisma.hotelReservation.count({ where }),
  ])

  return { rows, total }
}

/** One reservation with everything the drawer needs, including its audit trail. */
export async function getReservationDetail(id: string) {
  const row = await prisma.hotelReservation.findUnique({
    where: { id },
    include: {
      ...RESERVATION_INCLUDE,
      events: { orderBy: { createdAt: 'desc' }, take: 200 },
    },
  })
  if (!row) return null

  // Soft links, resolved now rather than stored.
  const [booking, accommodation, hotel] = await Promise.all([
    prisma.booking.findUnique({
      where: { bookingRef: row.bookingRef },
      select: {
        id: true, bookingRef: true, agent: true, status: true, operationCountry: true,
        paxAdults: true, paxChildren: true, paxInfants: true,
        passengers: { select: { name: true, type: true, isLead: true } },
        accommodations: {
          select: { id: true, hotel: true, checkIn: true, checkOut: true, nights: true, roomType: true, mealType: true },
        },
      },
    }),
    row.accommodationId
      ? prisma.accommodation.findUnique({ where: { id: row.accommodationId } })
      : null,
    row.hotelProfileId
      ? prisma.hotelProfile.findUnique({
          where: { id: row.hotelProfileId },
          include: { channels: true },
        })
      : null,
  ])

  // Re-resolve the accommodation by key when the stored pointer went stale.
  const resolvedAccommodation =
    accommodation ??
    booking?.accommodations.find(
      a => buildReservationKey(row.bookingRef, a.hotel, a.checkIn) === row.reservationKey,
    ) ??
    null

  const contract = row.contractId
    ? await prisma.hotelContract.findUnique({ where: { id: row.contractId }, include: { rates: true } })
    : row.hotelProfileId
      ? await findLiveContract(row.hotelProfileId, row.checkIn, row.checkOut)
      : null

  return { reservation: row, booking, accommodation: resolvedAccommodation, hotel, contract }
}

/** The active contract covering a date window for a property, if any. */
export async function findLiveContract(hotelProfileId: string, checkIn: Date, checkOut: Date) {
  return prisma.hotelContract.findFirst({
    where: {
      hotelProfileId,
      status: 'ACTIVE',
      validFrom: { lte: checkIn },
      validTo: { gte: checkOut },
    },
    include: { rates: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { validFrom: 'desc' },
  })
}

// ─── Deadline board ──────────────────────────────────────────────────────────

export interface BoardRow {
  id: string
  bookingRef: string
  hotelName: string
  city: string | null
  checkIn: string
  status: ReservationStatusValue
  /** The deadline that put this row on the board. */
  dueAt: string | null
  urgency: Urgency
  /** Human-readable reason it is here. */
  reason: string
  currency: string
  amount: number | null
  assignedToEmail: string | null
}

export interface BoardData {
  optionReleasing: BoardRow[]
  awaitingHotel: BoardRow[]
  paymentDue: BoardRow[]
  proformaMissing: BoardRow[]
  creditNotesAgeing: BoardRow[]
  summary: {
    todayCheckIns: number
    unassignedRequests: number
    openReservations: number
    securedPct: number | null
  }
}

export async function getDeadlineBoard(countries: Countries, myEmail?: string | null): Promise<BoardData> {
  const now = new Date()
  const scope = countryWhere(countries)

  const releaseCutoff = new Date(now.getTime() + OPTION_RELEASE_WARN_HOURS * 3_600_000)
  const paymentCutoff = new Date(now.getTime() + PAYMENT_DUE_WARN_DAYS * 86_400_000)
  const silenceCutoff = new Date(now.getTime() - HOTEL_SILENCE_HOURS * 3_600_000)

  const [held, awaiting, payment, confirmed, credits, todayCount, unassigned, openCount, securedCount] =
    await Promise.all([
      prisma.hotelReservation.findMany({
        where: { ...scope, status: 'OPTION_HELD', optionHeldUntil: { not: null, lte: releaseCutoff } },
        orderBy: { optionHeldUntil: 'asc' }, take: 100,
      }),
      prisma.hotelReservation.findMany({
        where: {
          ...scope,
          status: { in: ['PENDING_HOTEL', 'AMEND_REQUESTED', 'CANCEL_REQUESTED'] },
          OR: [{ lastContactedAt: { lte: silenceCutoff } }, { lastContactedAt: null }],
        },
        orderBy: { lastContactedAt: 'asc' }, take: 100,
      }),
      prisma.hotelReservation.findMany({
        where: {
          ...scope, paidAt: null,
          paymentDueAt: { not: null, lte: paymentCutoff },
          status: { notIn: TERMINAL_STATUSES },
        },
        orderBy: { paymentDueAt: 'asc' }, take: 100,
      }),
      prisma.hotelReservation.findMany({
        where: {
          ...scope,
          status: { in: SECURED_STATUSES },
          proformaDueAt: { not: null, lte: now },
          invoices: { none: {} },
        },
        orderBy: { proformaDueAt: 'asc' }, take: 100,
      }),
      prisma.creditNote.findMany({
        where: {
          status: { in: ['PENDING', 'REQUESTED', 'PROMISED'] },
          expectedBy: { not: null, lte: now },
        },
        orderBy: { expectedBy: 'asc' }, take: 100,
      }),
      prisma.hotelReservation.count({
        where: {
          ...scope,
          checkIn: { gte: startOfDay(now), lt: new Date(startOfDay(now).getTime() + 86_400_000) },
        },
      }),
      prisma.hotelReservation.count({
        where: { ...scope, assignedToEmail: null, status: { in: ['REQUESTED', 'QUOTING'] } },
      }),
      prisma.hotelReservation.count({
        where: { ...scope, status: { notIn: [...TERMINAL_STATUSES, 'CONFIRMED', 'AMENDED'] } },
      }),
      prisma.hotelReservation.count({ where: { ...scope, status: { in: SECURED_STATUSES } } }),
    ])

  const toRow = (r: typeof held[number], dueAt: Date | null, reason: string): BoardRow => ({
    id: r.id,
    bookingRef: r.bookingRef,
    hotelName: r.hotelName,
    city: r.city,
    checkIn: r.checkIn.toISOString(),
    status: r.status as ReservationStatusValue,
    dueAt: dueAt ? dueAt.toISOString() : null,
    urgency: classifyDeadline(dueAt, now),
    reason,
    currency: r.currency,
    amount: toNumber(r.totalCost),
    assignedToEmail: r.assignedToEmail,
  })

  const total = openCount + securedCount

  return {
    optionReleasing: held.map(r => {
      const hrs = r.optionHeldUntil ? Math.round((r.optionHeldUntil.getTime() - now.getTime()) / 3_600_000) : 0
      return toRow(r, r.optionHeldUntil, hrs < 0 ? `Hold lapsed ${Math.abs(hrs)}h ago` : `Releases in ${hrs}h`)
    }),
    awaitingHotel: awaiting.map(r => {
      const h = hoursSince(r.lastContactedAt, now)
      return toRow(r, r.lastContactedAt, h === null ? 'Never contacted' : `Silent ${Math.round(h)}h`)
    }),
    paymentDue: payment.map(r => toRow(r, r.paymentDueAt, `Payment due ${fmtDate(r.paymentDueAt)}`)),
    proformaMissing: confirmed.map(r => toRow(r, r.proformaDueAt, `No proforma since ${fmtDate(r.proformaDueAt)}`)),
    creditNotesAgeing: credits.map(c => ({
      id: c.id,
      bookingRef: c.bookingRef ?? '—',
      hotelName: c.hotelName,
      city: null,
      checkIn: c.raisedAt.toISOString(),
      status: 'CANCELLED' as ReservationStatusValue,
      dueAt: c.expectedBy ? c.expectedBy.toISOString() : null,
      urgency: classifyDeadline(c.expectedBy, now),
      reason: `Outstanding ${daysBetween(c.raisedAt, now)}d · chased ${c.chaseCount}×`,
      currency: c.currency,
      amount: toNumber(c.expectedAmount),
      assignedToEmail: null,
    })),
    summary: {
      todayCheckIns: todayCount,
      unassignedRequests: unassigned,
      openReservations: openCount,
      securedPct: total > 0 ? Math.round((securedCount / total) * 100) : null,
    },
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '—'
}

// ─── Booking rollup ──────────────────────────────────────────────────────────

export interface BookingHotelRollup {
  total: number
  secured: number
  rows: {
    id: string
    hotelName: string
    checkIn: string
    checkOut: string
    status: ReservationStatusValue
    confirmationNumber: string | null
    currency: string
    totalCost: number | null
  }[]
}

/**
 * The Hotels panel on the booking detail page: how much of this booking's
 * accommodation is actually secured with the properties.
 */
export async function getBookingHotelRollup(bookingRef: string): Promise<BookingHotelRollup> {
  const rows = await prisma.hotelReservation.findMany({
    where: { bookingRef: bookingRef.toUpperCase() },
    orderBy: { checkIn: 'asc' },
    select: {
      id: true, hotelName: true, checkIn: true, checkOut: true, status: true,
      confirmationNumber: true, currency: true, totalCost: true,
    },
  })

  const live = rows.filter(r => !TERMINAL_STATUSES.includes(r.status as ReservationStatusValue))

  return {
    total: live.length,
    secured: live.filter(r => SECURED_STATUSES.includes(r.status as ReservationStatusValue)).length,
    rows: rows.map(r => ({
      id: r.id,
      hotelName: r.hotelName,
      checkIn: r.checkIn.toISOString(),
      checkOut: r.checkOut.toISOString(),
      status: r.status as ReservationStatusValue,
      confirmationNumber: r.confirmationNumber,
      currency: r.currency,
      totalCost: toNumber(r.totalCost),
    })),
  }
}

// ─── Partner 360 ─────────────────────────────────────────────────────────────

export interface PartnerStats {
  hotelProfileId: string
  reservations: number
  confirmed: number
  cancelled: number
  totalSpend: number
  currency: string
  /** Median hours from our first contact to the property's first reply. */
  medianResponseHours: number | null
  openInvoices: number
  pendingCreditNotes: number
  pendingCreditValue: number
  /** 0–5, or null when there is not enough history to say anything useful. */
  score: number | null
}

export async function getPartnerStats(hotelProfileId: string): Promise<PartnerStats> {
  const [rows, invoices, credits] = await Promise.all([
    prisma.hotelReservation.findMany({
      where: { hotelProfileId },
      select: {
        status: true, baseTotalCost: true, totalCost: true, currency: true,
        lastContactedAt: true, firstResponseAt: true,
      },
    }),
    prisma.proformaInvoice.count({
      where: { hotelProfileId, status: { in: ['RECEIVED', 'UNDER_REVIEW', 'DISCREPANCY', 'VERIFIED', 'FORWARDED'] } },
    }),
    prisma.creditNote.findMany({
      where: { hotelProfileId, status: { in: ['PENDING', 'REQUESTED', 'PROMISED', 'DISPUTED'] } },
      select: { expectedAmount: true },
    }),
  ])

  const confirmed = rows.filter(r => SECURED_STATUSES.includes(r.status as ReservationStatusValue)).length
  const cancelled = rows.filter(r => r.status === 'CANCELLED' || r.status === 'REJECTED').length
  const spend = rows.reduce((sum, r) => sum + (toNumber(r.baseTotalCost) ?? toNumber(r.totalCost) ?? 0), 0)

  const responses = rows
    .map(r => (r.firstResponseAt && r.lastContactedAt
      ? (r.firstResponseAt.getTime() - r.lastContactedAt.getTime()) / 3_600_000
      : null))
    .filter((n): n is number => n !== null && n >= 0)
    .sort((a, b) => a - b)
  const median = responses.length ? responses[Math.floor(responses.length / 2)] : null

  const pendingCreditValue = credits.reduce((s, c) => s + (toNumber(c.expectedAmount) ?? 0), 0)

  // A score needs history. Below five stays it says nothing, so it says nothing.
  let score: number | null = null
  if (rows.length >= 5) {
    const reliability = confirmed / rows.length
    const speed = median === null ? 0.5 : median <= 6 ? 1 : median <= 24 ? 0.75 : median <= 48 ? 0.5 : 0.25
    const clean = credits.length === 0 ? 1 : 0.6
    score = Math.round(((reliability * 0.5 + speed * 0.3 + clean * 0.2) * 5) * 10) / 10
  }

  return {
    hotelProfileId,
    reservations: rows.length,
    confirmed,
    cancelled,
    totalSpend: Math.round(spend * 100) / 100,
    currency: 'USD',
    medianResponseHours: median === null ? null : Math.round(median * 10) / 10,
    openInvoices: invoices,
    pendingCreditNotes: credits.length,
    pendingCreditValue: Math.round(pendingCreditValue * 100) / 100,
    score,
  }
}

/** Recompute a stay's derived money fields. Used by both create and update. */
export function deriveMoney(input: {
  nettRate: unknown
  roomCount: number
  checkIn: Date
  checkOut: Date
  fxRate?: unknown
}): { nights: number; totalCost: number | null; baseTotalCost: number | null } {
  const nights = nightsBetween(input.checkIn, input.checkOut)
  const totalCost = stayTotal(input.nettRate as never, input.roomCount, nights)
  const fx = toNumber(input.fxRate as never)
  const baseTotalCost =
    totalCost === null ? null : fx === null || fx === 0 ? null : Math.round(totalCost * fx * 100) / 100
  return { nights, totalCost, baseTotalCost }
}
