import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, computePNLLineTotal, fitTicketType } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole, PNLCategory } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Categories that turn into something the ground team has to buy. Kept in step
 * with the same map in ../route.ts, which creates these tickets on save.
 */
const TICKETABLE_CATEGORIES: Partial<Record<PNLCategory, string>> = {
  HOTEL:          'Hotel Voucher',
  TRANSPORT:      'Transfer Voucher',
  TICKETS:        'Entrance Ticket',
  GUIDES:         'Guide Service',
  CRUISE:         'Cruise Ticket',
  WATER:          'Water Activity',
  FLIGHT_TICKETS: 'Flight Ticket',
  OTHER:          'Service',
}

/**
 * Categories left out unless the caller asks for them by name.
 *
 * A ticket is a thing the ground team goes and buys, and on MY/SG/VN one that
 * Accounts approves and pays a portal for first. Hotels and transport are
 * neither: Accounts settles those with the supplier directly on the payables
 * board, and a voucher per stay and per transfer leg only buried the
 * attractions that do need buying.
 *
 * Same rule as the Detailed P&L's DEFAULT_TICKET_CATEGORIES, deliberately —
 * the two entry points must not disagree about what a ticket is for. Existing
 * hotel and transport tickets are untouched: this decides what is made, never
 * what is removed.
 */
const OPT_IN_CATEGORIES: PNLCategory[] = ['HOTEL', 'TRANSPORT']

/**
 * POST /api/bookings/[ref]/pnl/create-tickets
 *
 * Creates DRAFT tickets from the **booking system's own** P&L line items — the
 * ones stored by a manual P&L upload — for bookings the Accounts costing sheet
 * has no record of.
 *
 * Additive and repeatable: a line that already has a ticket is skipped, and no
 * existing ticket is modified or deleted. That is the difference between this
 * route and `POST /api/bookings/[ref]/pnl`, which replaces the whole P&L and
 * rebuilds the un-activated tickets along with it.
 *
 * Gated on `pnl:create` as well as `ticket:create`, because Accounts and the
 * Booking team own the P&L upload but do not carry the ticket permission.
 *
 * Returns { created, skipped }.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:create') && !hasPermission(role, 'pnl:create')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where:  { bookingRef: params.ref },
    select: { id: true, currency: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const pnl = await prisma.pNL.findUnique({
    where:   { bookingId: booking.id },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!pnl || pnl.lineItems.length === 0) {
    return buildApiError('No P&L is stored on this booking yet — upload one first.', 404)
  }

  // Lines that already produced a ticket stay untouched, whatever state that
  // ticket has reached.
  const existing = await prisma.ticket.findMany({
    where:  { bookingId: booking.id, pnlLineId: { in: pnl.lineItems.map(l => l.id) } },
    select: { pnlLineId: true },
  })
  const taken = new Set(existing.map(t => t.pnlLineId))

  // ?categories=HOTEL,TRANSPORT brings the opt-in ones back for a booking that
  // genuinely needs them. Anything unrecognised is ignored rather than refused.
  const asked = new Set(
    (req.nextUrl.searchParams.get('categories') ?? '')
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(c => (OPT_IN_CATEGORIES as string[]).includes(c)),
  )

  const wanted = (category: PNLCategory) =>
    Boolean(TICKETABLE_CATEGORIES[category])
    && (!OPT_IN_CATEGORIES.includes(category) || asked.has(category))

  const missing = pnl.lineItems.filter(l => wanted(l.category) && !taken.has(l.id))

  const notRequested = pnl.lineItems.filter(
    l => TICKETABLE_CATEGORIES[l.category] && !wanted(l.category) && !taken.has(l.id),
  ).length

  if (missing.length > 0) {
    await prisma.ticket.createMany({
      data: missing.map(l => {
        const cost = computePNLLineTotal(l, pnl.paxAdults, pnl.paxChildren)
        return {
          bookingId:   booking.id,
          pnlLineId:   l.id,
          type:        fitTicketType(`${TICKETABLE_CATEGORIES[l.category]} — ${l.activity}`),
          qty:         1,
          costPerUnit: cost,
          totalCost:   cost,
          currency:    booking.currency ?? 'USD',
          activated:   false,   // GT must activate before purchasing
          status:      'DRAFT' as const,
          notes:       `Created from the uploaded P&L line: ${l.activity}`,
        }
      }),
    })
  }

  const created = missing.length
  const skipped = pnl.lineItems.length - created

  const rest = notRequested
    ? `; ${notRequested} hotel/transport line${notRequested !== 1 ? 's' : ''} left out by default`
    : ''

  return buildApiSuccess(
    { created, skipped, notRequested },
    created > 0
      ? `${created} ticket${created !== 1 ? 's' : ''} created from the uploaded P&L, ${skipped} skipped${rest}`
      : `No new tickets to create${rest || ' — every P&L line already has one'}`,
  )
}
