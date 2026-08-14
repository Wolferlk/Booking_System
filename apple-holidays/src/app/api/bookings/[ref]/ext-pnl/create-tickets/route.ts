import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import {
  loadDetailedPnl, isLoaded, missMessage, syncTicketsFromDetailed,
  ALL_TICKET_CATEGORIES, type TicketSpec,
} from '@/lib/detailed-pnl'
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
 * ?categories=  — comma-separated: HOTEL, TRANSPORT, TICKETS, OTHER. Left off,
 *                 only attractions and other services are created (see
 *                 DEFAULT_TICKET_CATEGORIES): those are what the ground team
 *                 buys and Accounts approves. A booking that really does need a
 *                 hotel or transport ticket asks for it here.
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

  // Anything unrecognised is dropped rather than refused: the caller asking for
  // "MEALS" gets the default set, not an error page.
  const categories = (req.nextUrl.searchParams.get('categories') ?? '')
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter((c): c is TicketSpec['category'] => (ALL_TICKET_CATEGORIES as string[]).includes(c))

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

  // A write that fails here used to escape as an unhandled throw, which reaches
  // the browser as a 500 with an empty body — the panel then reported "Unexpected
  // end of JSON input" and said nothing about what actually went wrong.
  let sync
  try {
    sync = await syncTicketsFromDetailed(booking.id, result.detail, { resync, categories })
  } catch (err) {
    console.error('[ext-pnl] Ticket sync failed for', params.ref, err)
    const detail = err instanceof Error ? err.message.split('\n').pop()?.trim() : null
    return buildApiError(`Could not write the tickets for this costing sheet.${detail ? ` ${detail}` : ''}`, 500)
  }

  const { created, updated, skipped, notRequested } = sync

  // "6 lines were not asked for" is the honest end of the sentence when hotels
  // and transport are left out by default — without it the count silently drops
  // and reads as lines that went missing.
  const rest = notRequested
    ? `; ${notRequested} hotel/transport line${notRequested !== 1 ? 's' : ''} left out (ask for them by category if you need them)`
    : ''

  const msg = resync
    ? `Re-synced from the Detailed P&L: ${created} created, ${updated} updated, ${skipped} skipped${rest}`
    : `${created} ticket${created !== 1 ? 's' : ''} created from the Detailed P&L, ${skipped} already existed${rest}`

  return buildApiSuccess({ created, updated, skipped, notRequested }, msg)
}
