/**
 * Booking search for the Feedbacks explorer.
 *
 * Answers "which bookings match what I typed, and did any of them actually
 * leave feedback?" — the second half is what makes it useful, because a ref
 * with no feedback is a dead end and the picker should say so before the user
 * clicks it.
 *
 * Read-only. GET only.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolveViewer } from '../scope'

export const dynamic = 'force-dynamic'

const MAX_RESULTS = 40

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const scope = await resolveViewer(sp.get('country'))
  if (!scope.ok) return buildApiError(scope.error, scope.status)

  const q = sp.get('q')?.trim() ?? ''
  const onlyWithFeedback = sp.get('withFeedback') === '1'
  const limit = Math.min(Number(sp.get('limit')) || MAX_RESULTS, 100)

  const countryWhere = scope.viewer.countries ? { operationCountry: { in: scope.viewer.countries } } : {}

  // An empty query is not an error — it seeds the picker with the trips that
  // most recently finished, which is what the team wants to look at anyway.
  const searchWhere = q
    ? {
        OR: [
          { bookingRef: { contains: q } },
          { isNumber: { contains: q } },
          { dealName: { contains: q } },
          { agent: { contains: q } },
          { tourDestination: { contains: q } },
          { passengers: { some: { name: { contains: q } } } },
        ],
      }
    : {}

  const bookings = await prisma.booking.findMany({
    where: { ...countryWhere, ...searchWhere },
    select: {
      bookingRef: true, isNumber: true, agent: true, status: true,
      operationCountry: true, tourDestination: true,
      arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, paxInfants: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
      guestFeedback: { select: { id: true } },
      customerFeedback: { select: { rating: true } },
      _count: { select: { contactLogs: true } },
    },
    orderBy: { arrivalDate: 'desc' },
    take: limit,
  })

  const refs = bookings.map(b => b.bookingRef)

  // Which of these actually have call feedback — three cheap grouped counts
  // rather than a per-booking query.
  const [onGround, reconfirm, postTour, alerts] = refs.length
    ? await Promise.all([
        prisma.tbl_te_feedback.groupBy({ by: ['booking_ref'], where: { booking_ref: { in: refs } }, _count: { _all: true } }),
        prisma.tbl_te_reconfirmation.groupBy({ by: ['booking_ref'], where: { booking_ref: { in: refs } }, _count: { _all: true } }),
        prisma.tbl_te_post_tour.groupBy({ by: ['booking_ref'], where: { booking_ref: { in: refs } }, _count: { _all: true } }),
        prisma.tbl_te_important_alerts.findMany({
          where: { booking_ref: { in: refs } },
          select: { booking_ref: true, status: true, severity: true },
        }),
      ])
    : [[], [], [], []]

  const countOf = (rows: { booking_ref: string | null; _count: { _all: number } }[]) =>
    new Map(rows.filter(r => r.booking_ref).map(r => [r.booking_ref as string, r._count._all]))

  const onGroundBy = countOf(onGround)
  const reconfirmBy = countOf(reconfirm)
  const postTourBy = countOf(postTour)

  const alertsBy = new Map<string, { total: number; open: number; high: number }>()
  for (const a of alerts) {
    if (!a.booking_ref) continue
    const e = alertsBy.get(a.booking_ref) ?? { total: 0, open: 0, high: 0 }
    e.total += 1
    if (!['resolved', 'closed', 'done', 'dismissed'].includes(String(a.status).toLowerCase())) e.open += 1
    if (String(a.severity).toLowerCase() === 'high') e.high += 1
    alertsBy.set(a.booking_ref, e)
  }

  const results = bookings.map(b => {
    const calls = (onGroundBy.get(b.bookingRef) ?? 0) + (reconfirmBy.get(b.bookingRef) ?? 0) + (postTourBy.get(b.bookingRef) ?? 0)
    const alert = alertsBy.get(b.bookingRef) ?? { total: 0, open: 0, high: 0 }
    return {
      bookingRef: b.bookingRef,
      isNumber: b.isNumber,
      clientName: b.passengers[0]?.name ?? null,
      agent: b.agent,
      status: b.status,
      operationCountry: b.operationCountry,
      tourDestination: b.tourDestination,
      arrivalDate: b.arrivalDate.toISOString(),
      departureDate: b.departureDate.toISOString(),
      pax: b.paxAdults + b.paxChildren + b.paxInfants,
      signals: {
        calls,
        onGroundCalls: onGroundBy.get(b.bookingRef) ?? 0,
        reconfirmCalls: reconfirmBy.get(b.bookingRef) ?? 0,
        postTourCalls: postTourBy.get(b.bookingRef) ?? 0,
        form: !!b.guestFeedback,
        deskNote: !!b.customerFeedback,
        contactLogs: b._count.contactLogs,
        complaints: alert.total,
        openComplaints: alert.open,
        highComplaints: alert.high,
      },
      hasFeedback: calls > 0 || !!b.guestFeedback || !!b.customerFeedback || alert.total > 0,
    }
  })

  return buildApiSuccess({
    results: onlyWithFeedback ? results.filter(r => r.hasFeedback) : results,
    total: results.length,
    query: q,
  })
}
