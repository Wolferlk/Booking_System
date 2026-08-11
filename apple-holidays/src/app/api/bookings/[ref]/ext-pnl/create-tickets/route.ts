import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { loadDetailedPnl, isLoaded, missMessage, syncTicketsFromDetailed } from '@/lib/detailed-pnl'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bookings/[ref]/ext-pnl/create-tickets
 *
 * Creates tickets from the Accounts system's **Detailed P&L** — the costing
 * sheet — rather than from the flat `pnl_items` invoice lines this route used
 * to read. Those lines lumped a whole tour's transport into two rows reading
 * "Transport"; the costing sheet itemises every hotel stay, attraction,
 * transfer leg, transport charge and meal day, which is what operations
 * actually has to buy.
 *
 * ?resync=true  — update existing DRAFT tickets from the sheet and create any
 *                 new ones. PURCHASED / PAID tickets are never modified.
 * (default)     — create tickets only for costing lines that have none yet.
 *
 * Tickets created before this change carry a "PNL Item #<id>" tag and are left
 * exactly as they are: nothing is deleted or rewritten, so anything already
 * purchased against them still stands.
 *
 * Returns { created, updated, skipped }.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:create')) return buildApiError('Forbidden', 403)

  const resync = req.nextUrl.searchParams.get('resync') === 'true'

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
    console.error('[ext-pnl] Accounts DB read failed while creating tickets:', err)
    return buildApiError('Could not reach the Accounts database. No tickets were created.', 502)
  }

  if (!isLoaded(result)) return buildApiError(missMessage(result), 404)

  const { created, updated, skipped } = await syncTicketsFromDetailed(booking.id, result.detail, { resync })

  const msg = resync
    ? `Re-synced from the Detailed P&L: ${created} created, ${updated} updated, ${skipped} skipped`
    : `${created} ticket${created !== 1 ? 's' : ''} created from the Detailed P&L, ${skipped} already existed`

  return buildApiSuccess({ created, updated, skipped }, msg)
}
