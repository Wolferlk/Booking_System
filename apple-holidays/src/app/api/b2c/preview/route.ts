/**
 * Preview the upcoming Aahaas orders, fully mapped, WITHOUT writing anything.
 *
 * This is the safety valve for the whole integration: staff see the exact bookings
 * an import would create — country, pax, dates, totals, P&L line count — and can
 * check them against the store before any row is inserted.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { isB2cBooking } from '@/lib/booking-source'
import {
  fetchFlightBookings,
  fetchOrderCustomers,
  fetchOrderHeaders,
  fetchOrderProducts,
  isB2cConfigured,
} from '@/lib/b2c-db'
import { mapB2cOrder } from '@/lib/b2c-booking-map'
import { parseFlightBooking } from '@/lib/b2c-flight'
import { dateInTz } from '@/lib/b2c-import'
import { fetchOrderChainFacts } from '@/lib/b2c-order-chain'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  if (!isB2cConfigured()) {
    return buildApiError('B2C database is not configured — set DB_DATABASE_B2C', 503)
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '200') || 200, 500)
  const upcomingFrom = req.nextUrl.searchParams.get('from') || dateInTz(new Date(), TZ)

  try {
    const headers = await fetchOrderHeaders({ upcomingFrom, limit })
    const orderIds = headers.map((h) => Number(h.order_id))

    if (orderIds.length === 0) {
      return buildApiSuccess({ upcomingFrom, orders: [], skipped: [], counts: zeroCounts() })
    }

    const [products, customers, flightRows] = await Promise.all([
      fetchOrderProducts(orderIds),
      fetchOrderCustomers(orderIds),
      fetchFlightBookings(orderIds),
    ])

    const productsByOrder = groupBy(products, (p) => Number(p.order_id))
    const customerByOrder = new Map(customers.map((c) => [Number(c.order_id), c]))
    const flightsByOrder = groupBy(flightRows.map(parseFlightBooking), (f) => f.orderId)

    // Order versions: an amendment updates its ORIGINAL booking, never makes a
    // new one; a superseded order is never imported on its own.
    const chain = await fetchOrderChainFacts(orderIds)
    const chainRef = (id: number) => String(chain.get(id)?.chainId ?? id)

    // Which refs already exist on our side, and as what.
    const refs = Array.from(new Set([...orderIds.map(String), ...orderIds.map(chainRef)]))
    const existing = await prisma.booking.findMany({
      where: { bookingRef: { in: refs } },
      select: { bookingRef: true, agent: true },
    })
    const existingByRef = new Map(existing.map((e) => [e.bookingRef, e]))

    const orders: Record<string, unknown>[] = []
    const skipped: { orderId: number; reason: string; detail: string }[] = []

    for (const header of headers) {
      const id = Number(header.order_id)
      const result = mapB2cOrder({
        header,
        products: productsByOrder.get(id) ?? [],
        customer: customerByOrder.get(id),
        flights: flightsByOrder.get(id) ?? [],
      })

      if (!result.ok) {
        skipped.push({ orderId: id, reason: result.reason, detail: result.detail })
        continue
      }

      const b = result.booking
      const fact = chain.get(id)
      const own = existingByRef.get(b.bookingRef)
      if (fact?.supersededBy && !own) {
        skipped.push({ orderId: id, reason: 'superseded', detail: `Amended into order ${fact.supersededBy} — that version is the booking.` })
        continue
      }
      // An amendment is filed under its original's ref: it updates that booking.
      if (fact?.isAmendment) b.bookingRef = chainRef(id)
      const prior = own ?? existingByRef.get(b.bookingRef)
      const status = fact?.isAmendment && prior && isB2cBooking(prior.agent)
        ? 'amendment'
        : !prior ? 'new' : isB2cBooking(prior.agent) ? 'imported' : 'conflict'

      // Cost/sell totals let Accounts eyeball the margin before committing.
      const sell = b.pnlLines.reduce((s, l) => s + l.mmtRate, 0)
      const cost = b.pnlLines.reduce(
        (s, l) =>
          s +
          (l.sicRate + l.pvtRatePP + l.otherRate) * (b.paxAdults + b.paxChildren) +
          l.adEntrance * b.paxAdults +
          l.chEntrance * b.paxChildren,
        0,
      )

      orders.push({
        status,
        bookingRef: b.bookingRef,
        operationCountry: b.operationCountry,
        countryVia: b.source.countryResolvedVia,
        arrivalDate: b.arrivalDate,
        departureDate: b.departureDate,
        paxAdults: b.paxAdults,
        paxChildren: b.paxChildren,
        paxInfants: b.paxInfants,
        paxVia: b.source.paxResolvedVia,
        currency: b.currency,
        quotedTotal: b.quotedTotal,
        destination: b.tourDestination,
        leadPassengerName: b.leadPassengerName,
        contactEmail: b.contactEmail,
        contactPhone: b.contactPhone,
        productLines: b.itineraryItems.length,
        pnlLines: b.pnlLines.length,
        sellTotal: round2(sell),
        costTotal: round2(cost),
        margin: round2(sell - cost),
        paymentStatus: b.pnlLines[0]?.paymentStatus ?? null,
        flightRoutes: b.source.flightRoutes,
        items: b.itineraryItems.map((i) => ({ dayNo: i.dayNo, date: i.date, title: i.title })),
        categories: Array.from(new Set(b.pnlLines.map((l) => l.category))),
      })
    }

    return buildApiSuccess({
      upcomingFrom,
      orders,
      skipped,
      counts: {
        candidates: headers.length,
        new: orders.filter((o) => o.status === 'new').length,
        imported: orders.filter((o) => o.status === 'imported' || o.status === 'amendment').length,
        conflict: orders.filter((o) => o.status === 'conflict').length,
        skipped: skipped.length,
      },
    })
  } catch (err) {
    console.error('[GET /api/b2c/preview]', err)
    return buildApiError(err instanceof Error ? err.message : 'Preview failed', 500)
  }
}

function zeroCounts() {
  return { candidates: 0, new: 0, imported: 0, conflict: 0, skipped: 0 }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function groupBy<T>(rows: T[], key: (r: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}
