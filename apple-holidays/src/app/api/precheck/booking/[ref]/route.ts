import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardPrecheck } from '@/lib/precheck-guard'
import { buildPrecheckQueue, summarizeQueue } from '@/lib/hotel-precheck'

export const dynamic = 'force-dynamic'

/**
 * GET /api/precheck/booking/[ref] — every hotel stay on one booking.
 *
 * Powers the Pre-checking panel on the booking detail page. Unlike the queue
 * it shows the whole trip regardless of how far out it is, including stays the
 * guest arranged themselves and stays already in the past — on a single
 * booking the operator wants the complete picture, not just what is due.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard

  const ref = decodeURIComponent(params.ref).trim()

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { bookingRef: true, operationCountry: true, isNumber: true, agent: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  if (session.countries && !(booking.operationCountry && session.countries.includes(booking.operationCountry))) {
    return buildApiError('Forbidden', 403)
  }

  try {
    // Scoped to this one booking, but through the same queue builder — it is
    // the single place stay keys, D-10 dates and hotel joins are computed, and
    // the panel must agree with the queue exactly.
    const rows = await buildPrecheckQueue({
      bookingRefs: [booking.bookingRef],
      horizonDays: 365,
      pastDays: 730,
      includePast: true,
      includeOwnArrangement: true,
    })

    // Timeline events for stays that have been worked on.
    const ids = rows.map(r => r.reconfirmId).filter((v): v is string => !!v)
    const events = ids.length === 0 ? [] : await prisma.hotelReconfirmationEvent.findMany({
      where: { reconfirmId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const eventsByStay: Record<string, typeof events> = {}
    for (const r of rows) {
      if (!r.reconfirmId) continue
      eventsByStay[r.stayKey] = events.filter(e => e.reconfirmId === r.reconfirmId)
    }

    return buildApiSuccess({
      booking,
      rows,
      stats: summarizeQueue(rows),
      events: eventsByStay,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[precheck/booking]', e)
    return buildApiError(`Could not load pre-checking for ${ref}: ${(e as Error).message}`, 500)
  }
}
