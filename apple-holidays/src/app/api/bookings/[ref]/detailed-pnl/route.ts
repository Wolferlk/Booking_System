import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { loadDetailedPnl, isLoaded, missMessage } from '@/lib/detailed-pnl'

export const dynamic = 'force-dynamic'

/**
 * GET /api/bookings/[ref]/detailed-pnl
 *
 * The Accounts system's Detailed P&L for this booking, matched on IS number and
 * built from the Apple System costing stored in the Accounts database. Read
 * only — nothing on either side is written by this route.
 *
 * Answers `{ available: false, message }` rather than a 404 when the booking
 * simply has no stored P&L: that is an ordinary state for a new booking, and
 * the panel says so instead of showing an error.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, isNumber: true, bookingRef: true, agentBookingId: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  let result
  try {
    result = await loadDetailedPnl({
      isNumber:      booking.isNumber,
      tourRef:       booking.bookingRef,
      invoiceNumber: booking.agentBookingId,
    })
  } catch (err) {
    // The Accounts DB being unreachable is a different problem from a booking
    // having no P&L, and the page has to be able to tell them apart.
    console.error('[detailed-pnl] Accounts DB read failed:', err)
    return buildApiError('Could not reach the Accounts database. Try again in a moment.', 502)
  }

  if (!isLoaded(result)) {
    return buildApiSuccess({ available: false, reason: result.reason, message: missMessage(result) })
  }

  const { record, payload, detail, matchedBy } = result

  return buildApiSuccess({
    available: true,
    html: detail.html,
    totals: detail.totals,
    currency: detail.currency,
    // How many purchasable lines the sheet holds, so the panel can say what
    // "Create tickets" is about to do before it does it.
    lineCounts: {
      hotels:    detail.tables.stays.length,
      products:  detail.tables.products.length,
      transfers: detail.tables.transfers.length,
      transport: detail.tables.transport.filter(t => !t.info).length,
      meals:     detail.tables.meals.length + detail.tables.mealExtras.length,
      others:    detail.tables.others.length,
    },
    source: {
      matchedBy,
      recordId:       record.id,
      isNumber:       record.is_number,
      quotationNo:    payload.quotation_no,
      referenceId:    payload.reference_id,
      revision:       payload.revision,
      countryCode:    record.country_code,
      approvalStatus: record.pnl_approval_status,
    },
  })
}
