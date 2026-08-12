/**
 * Pre-checking engine — the D-10 Hotel Reconfirmation queue.
 *
 * Every hotel stay must be reconfirmed with the property ten days before the
 * guest checks in. This module turns `bookings` + `accommodations` (the live
 * operational data) into a queue of stays, joins each one to whatever
 * reconfirmation record and hotel profile already exist, and works out how
 * urgent it is.
 *
 * Reads only. Nothing here creates a `hotel_reconfirmations` row — the queue
 * is derived on every request, and rows materialise lazily the first time
 * somebody actually records something (see `updateReconfirmation`).
 *
 * Server-only: importing this module pulls in Prisma. The shapes and the pure
 * D-10 arithmetic live in `precheck-shared.ts` so the browser can use them
 * too; they are re-exported below, so server code only ever needs this import.
 */
import type { OperationCountry, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { normalizeHotelName } from './hotel-match'
import { contactHealth, countryCodeForOperation } from './hotel-contact'
import {
  OVERDUE_GRACE_DAYS, buildStayKey, classifyStay, daysBetween, startOfUtcDay,
  type PrecheckHotel, type PrecheckStay, type Urgency,
} from './precheck-shared'

export * from './precheck-shared'

const DAY_MS = 86_400_000

type HotelWithChannels = Prisma.HotelProfileGetPayload<{ include: { channels: true } }>

function toPrecheckHotel(h: HotelWithChannels): PrecheckHotel {
  const channels = h.channels
    .slice()
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.kind.localeCompare(b.kind))
    .map(c => ({
      id: c.id, kind: c.kind, label: c.label, value: c.value, e164: c.e164,
      isPrimary: c.isPrimary, verified: c.verified, guessed: c.guessed, notes: c.notes,
    }))

  return {
    id: h.id,
    name: h.name,
    accountsHotelId: h.accountsHotelId,
    accountsHotelName: h.accountsHotelName,
    city: h.city,
    countryCode: h.countryCode,
    phone: h.phone,
    email: h.email,
    whatsapp: h.whatsapp,
    whatsappVerified: h.whatsappVerified,
    website: h.website,
    address: h.address,
    googleMapsUrl: h.googleMapsUrl,
    source: h.source,
    notes: h.notes,
    aiResearchedAt: h.aiResearchedAt?.toISOString() ?? null,
    verifiedAt: h.verifiedAt?.toISOString() ?? null,
    channels,
    health: contactHealth({
      phone: h.phone, whatsapp: h.whatsapp, whatsappVerified: h.whatsappVerified,
      email: h.email, channelCount: channels.length,
    }),
  }
}

export interface QueueFilters {
  /** Restrict to these operationCountry values (null = all). */
  countries?: string[] | null
  /**
   * Restrict to specific bookings. The per-booking panel uses this so it scans
   * one booking rather than a country's worth of them.
   */
  bookingRefs?: string[] | null
  /** Only stays checking in within this many days. Default 60. */
  horizonDays?: number
  /** Free text over booking ref, IS number, agent, guest or hotel name. */
  search?: string | null
  /** Restrict to these reconfirmation statuses. */
  statuses?: string[] | null
  /** Restrict to these urgency buckets. */
  urgencies?: Urgency[] | null
  /** Include stays the guest has already checked into. Default false. */
  includePast?: boolean
  /** Include stays the guest arranged themselves. Default false. */
  includeOwnArrangement?: boolean
  /**
   * How far back to look, in days. Defaults to the 30-day overdue grace window;
   * the per-booking panel widens it so an amended or late-loaded trip still
   * shows its earlier stays.
   */
  pastDays?: number
  now?: Date
}

/**
 * Build the Pre-checking queue.
 *
 * One booking may hold a dozen stays, so this deliberately fetches bookings
 * (with accommodations) once, then the reconfirmation rows and hotel profiles
 * in two more queries, and stitches them in memory. Doing it per-stay would
 * mean hundreds of round trips on a busy month.
 */
export async function buildPrecheckQueue(f: QueueFilters = {}): Promise<PrecheckStay[]> {
  const now = f.now ?? new Date()
  const horizon = f.horizonDays ?? 60
  const today = startOfUtcDay(now)

  const from = new Date(today.getTime() - (f.pastDays ?? OVERDUE_GRACE_DAYS) * DAY_MS)
  const to = new Date(today.getTime() + horizon * DAY_MS)

  const where: Prisma.BookingWhereInput = {
    status: { not: 'CANCELLED' },
    accommodations: { some: { checkIn: { gte: from, lte: to } } },
  }
  if (f.bookingRefs && f.bookingRefs.length > 0) {
    where.bookingRef = { in: f.bookingRefs }
  }
  if (f.countries && f.countries.length > 0) {
    // Callers carry the country scope as plain strings through the API layer;
    // Prisma's filter wants the generated enum union, and the values are
    // already validated against it upstream.
    where.operationCountry = { in: f.countries as OperationCountry[] }
  }

  const bookings = await prisma.booking.findMany({
    where,
    select: {
      bookingRef: true, isNumber: true, agent: true, status: true,
      operationCountry: true, arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, paxInfants: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
      accommodations: {
        where: { checkIn: { gte: from, lte: to } },
        select: {
          id: true, city: true, hotel: true, checkIn: true, checkOut: true,
          nights: true, roomType: true, mealType: true, contact: true,
          ownArrangement: true,
        },
        orderBy: { checkIn: 'asc' },
      },
    },
    orderBy: { arrivalDate: 'asc' },
  })

  // Stay keys for every candidate stay, so the reconfirmation lookup is one query.
  const keys: string[] = []
  for (const b of bookings) {
    for (const a of b.accommodations) keys.push(buildStayKey(b.bookingRef, a.hotel, a.checkIn))
  }

  const recons = keys.length === 0 ? [] : await prisma.hotelReconfirmation.findMany({
    where: { stayKey: { in: keys } },
  })
  const reconByKey = new Map(recons.map(r => [r.stayKey, r]))

  // Hotel profiles: those explicitly linked, plus any whose normalised name
  // matches a stay exactly — that is a free, certain auto-match.
  const linkedIds = recons.map(r => r.hotelProfileId).filter((v): v is string => !!v)
  const normNames = Array.from(new Set(
    bookings.flatMap(b => b.accommodations.map(a => normalizeHotelName(a.hotel))).filter(Boolean),
  ))

  const profiles = await prisma.hotelProfile.findMany({
    where: { OR: [{ id: { in: linkedIds } }, { normalizedName: { in: normNames } }] },
    include: { channels: true },
  })
  const profileById = new Map(profiles.map(p => [p.id, p]))
  const profileByNorm = new Map(profiles.map(p => [p.normalizedName, p]))

  const search = f.search?.trim().toLowerCase() || null
  const statusSet = f.statuses && f.statuses.length > 0 ? new Set(f.statuses) : null
  const urgencySet = f.urgencies && f.urgencies.length > 0 ? new Set<Urgency>(f.urgencies) : null

  const out: PrecheckStay[] = []

  for (const b of bookings) {
    const leadGuest = b.passengers[0]?.name ?? null
    const countryCode = countryCodeForOperation(b.operationCountry)

    for (const a of b.accommodations) {
      if (a.ownArrangement && !f.includeOwnArrangement) continue

      const stayKey = buildStayKey(b.bookingRef, a.hotel, a.checkIn)
      const r = reconByKey.get(stayKey) ?? null

      const profile = (r?.hotelProfileId ? profileById.get(r.hotelProfileId) : undefined)
        ?? profileByNorm.get(normalizeHotelName(a.hotel))
        ?? null

      const status = r?.status ?? (a.ownArrangement ? 'NOT_REQUIRED' : 'PENDING')
      const info = classifyStay(a.checkIn, status, now, r?.dueAtOverride ?? null)

      if (!f.includePast && info.urgency === 'PAST') continue
      if (statusSet && !statusSet.has(status)) continue
      if (urgencySet && !urgencySet.has(info.urgency)) continue

      if (search) {
        const hay = [
          b.bookingRef, b.isNumber, b.agent, leadGuest, a.hotel, a.city,
          r?.confirmationNumber,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(search)) continue
      }

      const hotel = profile ? toPrecheckHotel(profile) : null
      const noContact =
        !hotel?.phone && !hotel?.whatsapp && !hotel?.email &&
        (hotel?.channels.length ?? 0) === 0 && !a.contact

      out.push({
        stayKey,
        reconfirmId: r?.id ?? null,

        bookingRef: b.bookingRef,
        isNumber: b.isNumber,
        agent: b.agent,
        leadGuest,
        operationCountry: b.operationCountry,
        countryCode,
        bookingStatus: b.status,
        arrivalDate: b.arrivalDate.toISOString(),
        departureDate: b.departureDate.toISOString(),

        accommodationId: a.id,
        hotelName: a.hotel,
        city: a.city,
        ownArrangement: a.ownArrangement,
        bookingContact: a.contact,

        checkIn: a.checkIn.toISOString(),
        checkOut: a.checkOut.toISOString(),
        nights: r?.nights || a.nights || Math.max(0, daysBetween(a.checkIn, a.checkOut)),
        roomType: r?.roomType ?? a.roomType,
        roomCategory: r?.roomCategory ?? null,
        roomCount: r?.roomCount ?? null,
        mealType: r?.mealType ?? a.mealType,
        // Pax defaults come off the booking — the TC rarely splits them per hotel.
        adults: r?.adults ?? b.paxAdults,
        children: r?.children ?? b.paxChildren,
        cwb: r?.cwb ?? null,
        cnb: r?.cnb ?? null,
        infants: r?.infants ?? b.paxInfants,

        status,
        confirmationNumber: r?.confirmationNumber ?? null,
        lastChannel: r?.lastChannel ?? null,
        attempts: r?.attempts ?? 0,
        lastCheckedAt: r?.lastCheckedAt?.toISOString() ?? null,
        lastCheckedBy: r?.lastCheckedBy ?? null,
        followUpAt: r?.followUpAt?.toISOString() ?? null,
        discrepancyNote: r?.discrepancyNote ?? null,
        notes: r?.notes ?? null,

        dueAt: info.dueAt.toISOString(),
        dueAtOverride: r?.dueAtOverride?.toISOString() ?? null,
        urgency: info.urgency,
        daysToCheckIn: info.daysToCheckIn,
        daysToDue: info.daysToDue,
        actionable: info.actionable,

        hotel,
        unmatched: !hotel,
        noContact,
      })
    }
  }

  // Most urgent first: overdue, then due today, then by due date.
  const rank: Record<Urgency, number> = {
    OVERDUE: 0, DUE_TODAY: 1, DUE_SOON: 2, UPCOMING: 3, SETTLED: 4, PAST: 5,
  }
  out.sort((x, y) => rank[x.urgency] - rank[y.urgency] || x.dueAt.localeCompare(y.dueAt))

  return out
}
