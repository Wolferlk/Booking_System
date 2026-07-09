import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchPnlVersionsForBooking, type PnlRecord } from '@/lib/accounts-db'
import { parseAmendment } from '@/lib/pnl-amendment'

export const dynamic = 'force-dynamic'

/**
 * GET — list every Accounts PNL version (base + amendments) available for this
 * booking, sorted latest-first, tagged with amendment info and flagged for the
 * currently-linked version. Powers the version switcher on the booking panel.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, isNumber: true, bookingRef: true, agentBookingId: true, externalPnlLink: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const linkedId = booking.externalPnlLink?.externalPnlId ?? null

  // Resolve versions by the currently-linked record's identity when present,
  // otherwise by the booking's own identifiers.
  const linkedRec = booking.externalPnlLink?.cachedRecord as unknown as PnlRecord | null
  const identifiers = linkedRec
    ? { isNumber: linkedRec.is_number, tourRef: linkedRec.tour_ref, invoiceNumber: linkedRec.invoice_number }
    : { isNumber: booking.isNumber, tourRef: booking.bookingRef, invoiceNumber: booking.agentBookingId }

  try {
    const res = await fetchPnlVersionsForBooking(identifiers)
    const versions = (res?.versions ?? []).map((r, i) => {
      const amd = parseAmendment(r.is_number)
      return {
        id:            r.id,
        is_number:     r.is_number,
        tour_ref:      r.tour_ref,
        invoice_number: r.invoice_number,
        pnl_date:      r.pnl_date,
        actual_amount: r.actual_amount,
        profit_loss:   r.profit_loss,
        currency:      r.currency,
        status:        r.status,
        update_count:  r.update_count,
        isAmendment:   amd.isAmendment,
        amendmentLabel: amd.label,
        isLatest:      i === 0,
        isLinked:      r.id === linkedId,
      }
    })
    return buildApiSuccess({ base: res?.base ?? null, matchedBy: res?.matchedBy ?? null, versions })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Accounts DB unreachable'
    return buildApiError(msg, 502)
  }
}
