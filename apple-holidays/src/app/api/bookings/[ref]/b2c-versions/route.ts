/**
 * Aahaas B2C store versions of this booking (see `b2c-version-links.ts`).
 *
 *   GET → { link, snapshots, liveStatus, changes }
 *     link       — this booking's place in its store chain (null = one version only)
 *     snapshots  — the ops details of every version that has a booking here,
 *                  so the active booking can show "what the previous booking was"
 *                  and a replaced one can show what replaced it.
 *     liveStatus — has the store's current version reached this booking yet?
 *     changes    — what each same-order version did to the order's lines.
 *
 * The chain is re-read from the store on every open (budgeted); when the store
 * cannot be reached the cached link is answered instead.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { isB2cBooking } from '@/lib/booking-source'
import { getVersionLinks, refreshVersionLinks, type B2cVersionLink } from '@/lib/b2c-version-links'
import { listAmendmentNotices } from '@/lib/b2c-amendments'
import { fetchLineChanges } from '@/lib/b2c-same-order'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const STORE_BUDGET_MS = 6000

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('store read timed out')), ms))])
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { bookingRef: true, agent: true, operationCountry: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  const sessionCountry = session.user.country as OperationCountry | undefined
  if (sessionCountry && sessionCountry !== 'ALL' && !isInCountryScope(booking.operationCountry as OperationCountry, sessionCountry)) {
    return buildApiError('Forbidden — this booking belongs to another country.', 403)
  }
  if (!isB2cBooking(booking.agent) || !/^\d+$/.test(booking.bookingRef)) {
    return buildApiSuccess({ link: null, snapshots: [], fresh: false })
  }

  let link: B2cVersionLink | null = null
  let fresh = false
  try {
    const links = await within(refreshVersionLinks([booking.bookingRef]), STORE_BUDGET_MS)
    link = links.get(booking.bookingRef) ?? null
    fresh = true
  } catch (err) {
    console.warn('[b2c-versions] store unreachable, using cached link:', err instanceof Error ? err.message : err)
    link = (await getVersionLinks([booking.bookingRef])).get(booking.bookingRef) ?? null
  }
  if (!link) return buildApiSuccess({ link: null, snapshots: [], fresh })

  const refs = link.versions.map((v) => v.ref).filter((r): r is string => !!r)
  const rows = await prisma.booking.findMany({
    where: { bookingRef: { in: refs } },
    select: {
      bookingRef: true, status: true, arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, paxInfants: true, quotedTotal: true, currency: true,
      operationCountry: true, tourDestination: true, createdAt: true, version: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
      accommodations: { select: { hotel: true, city: true, checkIn: true, nights: true }, orderBy: { checkIn: 'asc' } },
      _count: { select: { flights: true, itineraryItems: true, tickets: true } },
    },
  })
  const snapshots = rows.map((b) => ({
    ref: b.bookingRef,
    status: b.status,
    arrivalDate: b.arrivalDate,
    departureDate: b.departureDate,
    paxAdults: b.paxAdults,
    paxChildren: b.paxChildren,
    paxInfants: b.paxInfants,
    quotedTotal: b.quotedTotal != null ? Number(b.quotedTotal) : null,
    currency: b.currency,
    operationCountry: b.operationCountry,
    destination: b.tourDestination,
    createdAt: b.createdAt,
    opsVersion: b.version,
    lead: b.passengers[0]?.name ?? null,
    hotels: b.accommodations.map((a) => `${a.hotel}${a.city ? ` (${a.city})` : ''} · ${a.nights}N`),
    flights: b._count.flights,
    itinerary: b._count.itineraryItems,
    tickets: b._count.tickets,
  }))

  // Null when no notice names it: the booking was imported from it, or it predates notices.
  const liveEntry = link.versions.find((v) => v.live)
  const notices = liveEntry ? await listAmendmentNotices({ bookingRef: booking.bookingRef }).catch(() => []) : []
  const notice = liveEntry
    ? notices.find((n) => n.orderId === liveEntry.orderId && (!liveEntry.sameOrder || n.version === liveEntry.version))
    : undefined
  const liveStatus = notice
    ? { applied: !!notice.appliedAt, lastError: notice.lastError ?? null, leftForReview: notice.leftForReview ?? [] }
    : null

  const sameOrderIds = Array.from(new Set(link.versions.filter((v) => v.sameOrder).map((v) => v.orderId)))
  const changes = fresh && sameOrderIds.length > 0
    ? (await within(Promise.all(sameOrderIds.map(fetchLineChanges)), STORE_BUDGET_MS).catch(() => [])).flat()
    : []

  return buildApiSuccess({ link, snapshots, fresh, liveStatus, changes })
}
