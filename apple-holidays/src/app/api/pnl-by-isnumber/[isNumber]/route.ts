import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, computePNLTotals } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pnl-by-isnumber/[isNumber]
 * Public endpoint — no auth required.
 * Returns PNL data for the booking with the given IS number (e.g. VN11467, IS48375).
 *
 * curl example:
 *   curl http://localhost:3000/api/pnl-by-isnumber/VN11467
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { isNumber: string } },
) {
  const isNumber = params.isNumber.trim().toUpperCase()
  if (!isNumber) return buildApiError('IS number is required', 400)

  const booking = await prisma.booking.findFirst({
    where: { isNumber },
    orderBy: { createdAt: 'desc' },
  })

  if (!booking) {
    return buildApiError(`No booking found with IS number: ${isNumber}`, 404)
  }

  const pnl = await prisma.pNL.findUnique({
    where: { bookingId: booking.id },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })

  if (!pnl) {
    return buildApiError(
      `Booking ${booking.bookingRef} (IS: ${isNumber}) has no P&L record yet`,
      404,
    )
  }

  const computed = computePNLTotals(pnl)

  return buildApiSuccess({
    booking: {
      bookingRef:       booking.bookingRef,
      isNumber:         booking.isNumber,
      cntlNumber:       (booking as Record<string, unknown>).cntlNumber as string | null ?? null,
      agent:            booking.agent,
      arrivalDate:      booking.arrivalDate,
      departureDate:    booking.departureDate,
      paxAdults:        booking.paxAdults,
      paxChildren:      booking.paxChildren,
      operationCountry: booking.operationCountry,
      status:           booking.status,
    },
    pnl: {
      ...computed,
      isNumber:     booking.isNumber,
      cntlNumber:   (booking as Record<string, unknown>).cntlNumber as string | null ?? null,
      bookingAgent: booking.agent,
      sourceDocUrl: pnl.sourceDocUrl,
      lockedAt:     pnl.lockedAt,
      createdAt:    pnl.createdAt,
      updatedAt:    pnl.updatedAt,
    },
  })
}
