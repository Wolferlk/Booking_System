/**
 * GET  /api/reservations/credit-notes — the ageing register
 * POST /api/reservations/credit-notes — raise one
 *
 * The list carries its own ageing arithmetic so the register can sort by "who
 * owes us most, longest" without the browser re-deriving it per row.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertBookingInScope } from '@/lib/reservation-guard'
import { ageingBucket, daysBetween, toNumber } from '@/lib/reservation-shared'

export async function GET(req: NextRequest) {
  const g = await guardReservation('creditnote:read')
  if (!g.ok) return g.response

  const p = req.nextUrl.searchParams
  const status = p.get('status')?.split(',').filter(Boolean)
  const openOnly = p.get('open') === '1'

  const rows = await prisma.creditNote.findMany({
    where: {
      ...(status?.length ? { status: { in: status as never[] } } : {}),
      ...(openOnly ? { status: { in: ['PENDING', 'REQUESTED', 'PROMISED', 'DISPUTED'] } } : {}),
      ...(g.session.countries
        ? { reservation: { operationCountry: { in: g.session.countries as never[] } } }
        : {}),
    },
    include: { reservation: { select: { id: true, hotelName: true, checkIn: true } } },
    orderBy: [{ expectedBy: 'asc' }, { raisedAt: 'asc' }],
    take: Math.min(Number(p.get('take') ?? 300), 500),
  })

  const now = new Date()
  const enriched = rows.map(c => {
    const outstandingDays = daysBetween(c.raisedAt, now)
    return {
      ...c,
      outstandingDays,
      bucket: ageingBucket(outstandingDays),
      overdue: !!c.expectedBy && c.expectedBy < now,
    }
  })

  // Totals per ageing bucket, so the register leads with the shape of the debt.
  const buckets: Record<string, { count: number; value: number }> = {}
  for (const c of enriched) {
    const b = (buckets[c.bucket] ??= { count: 0, value: 0 })
    b.count++
    b.value += toNumber(c.expectedAmount) ?? 0
  }

  return buildApiSuccess({ rows: enriched, total: enriched.length, buckets })
}

export async function POST(req: NextRequest) {
  const g = await guardReservation('creditnote:manage')
  if (!g.ok) return g.response

  const body = await req.json()
  if (!body.hotelName && !body.reservationId) {
    return buildApiError('Either `reservationId` or `hotelName` is required', 422)
  }

  const reservation = body.reservationId
    ? await prisma.hotelReservation.findUnique({ where: { id: body.reservationId } })
    : null
  if (reservation && !(await assertBookingInScope(reservation.bookingRef, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }

  const created = await prisma.creditNote.create({
    data: {
      reservationId: reservation?.id ?? null,
      bookingRef: reservation?.bookingRef ?? body.bookingRef ?? null,
      hotelProfileId: reservation?.hotelProfileId ?? body.hotelProfileId ?? null,
      hotelName: reservation?.hotelName ?? body.hotelName,
      reason: body.reason ?? 'CANCELLATION',
      reasonNote: body.reasonNote ?? null,
      currency: body.currency ?? reservation?.currency ?? 'USD',
      expectedAmount: body.expectedAmount ?? null,
      // Thirty days is the default the desk chases to when nothing was agreed.
      expectedBy: body.expectedBy ? new Date(body.expectedBy) : new Date(Date.now() + 30 * 86_400_000),
      notes: body.notes ?? null,
      createdBy: g.session.actor.email ?? null,
    },
  })

  return buildApiSuccess(created, 201)
}
