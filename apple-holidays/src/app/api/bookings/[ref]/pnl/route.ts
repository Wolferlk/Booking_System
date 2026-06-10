import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, computePNLTotals, isClientPortalUnlocked, isCreditAgent } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole, PNLCategory } from '@prisma/client'

// Categories that should generate an auto-ticket for the ground team
const TICKETABLE_CATEGORIES: Partial<Record<PNLCategory, string>> = {
  HOTEL:          'Hotel Voucher',
  TICKETS:        'Entrance Ticket',
  GUIDES:         'Guide Service',
  CRUISE:         'Cruise Ticket',
  WATER:          'Water Activity',
  FLIGHT_TICKETS: 'Flight Ticket',
  OTHER:          'Service',
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  if (role === 'GT_USER' && !isClientPortalUnlocked(booking.arrivalDate)) {
    return buildApiError('P&L not available until T−5', 403)
  }

  const pnl = await prisma.pNL.findUnique({
    where: { bookingId: booking.id },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })

  if (!pnl) return buildApiSuccess(null)

  return buildApiSuccess({ ...computePNLTotals(pnl), bookingAgent: booking.agent })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:create')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  const { paxAdults, paxChildren, lineItems = [] } = await req.json()

  const existingPnl = await prisma.pNL.findUnique({ where: { bookingId: booking.id } })

  let pnl
  if (existingPnl) {
    // Delete old lines; existing tickets linked to those lines lose pnlLineId but stay
    await prisma.ticket.updateMany({
      where: { bookingId: booking.id, activated: false },
      data: { pnlLineId: null },
    })
    await prisma.pNLLineItem.deleteMany({ where: { pnlId: existingPnl.id } })
    pnl = await prisma.pNL.update({
      where: { id: existingPnl.id },
      data: {
        paxAdults:  Number(paxAdults  ?? booking.paxAdults),
        paxChildren: Number(paxChildren ?? booking.paxChildren),
      },
    })
  } else {
    pnl = await prisma.pNL.create({
      data: {
        bookingId:  booking.id,
        paxAdults:  Number(paxAdults  ?? booking.paxAdults),
        paxChildren: Number(paxChildren ?? booking.paxChildren),
      },
    })
  }

  // State advancement — run on every save (new or update)
  // Non-credit agents: GT_VERIFIED → AWAITING_PAYMENT_CONFIRM (first upload only)
  // Credit agents: GT_VERIFIED or AWAITING_PAYMENT_CONFIRM → OPERATIONS_READY (always)
  const creditAgent = isCreditAgent(booking.agent)
  if (creditAgent && ['GT_VERIFIED', 'AWAITING_PAYMENT_CONFIRM'].includes(booking.status)) {
    await Promise.all([
      prisma.booking.update({ where: { id: booking.id }, data: { status: 'OPERATIONS_READY' } }),
      prisma.statusEvent.create({
        data: {
          bookingId: booking.id,
          fromState: booking.status,
          toState:   'OPERATIONS_READY',
          actorId:   session.user.id,
          note: 'P&L saved — credit agent, advanced directly to Operations Ready',
        },
      }),
    ])
  } else if (!creditAgent && booking.status === 'GT_VERIFIED' && !existingPnl) {
    await Promise.all([
      prisma.booking.update({ where: { id: booking.id }, data: { status: 'AWAITING_PAYMENT_CONFIRM' } }),
      prisma.statusEvent.create({
        data: {
          bookingId: booking.id,
          fromState: 'GT_VERIFIED',
          toState:   'AWAITING_PAYMENT_CONFIRM',
          actorId:   session.user.id,
          note: 'P&L uploaded by Accounts Team — awaiting payment confirmation',
        },
      }),
    ])
  }

  // Create P&L line items
  const createdLines = await Promise.all(
    (lineItems as Record<string, unknown>[]).map((line, index) =>
      prisma.pNLLineItem.create({
        data: {
          pnlId:      pnl.id,
          activity:   line.activity as string,
          category:   (line.category as PNLCategory) || 'OTHER',
          mmtRate:    Number(line.mmtRate    ?? 0),
          sicRate:    Number(line.sicRate    ?? 0),
          pvtRatePP:  Number(line.pvtRatePP  ?? 0),
          adEntrance: Number(line.adEntrance ?? 0),
          chEntrance: Number(line.chEntrance ?? 0),
          otherRate:  Number(line.otherRate  ?? 0),
          notes:      line.notes as string | undefined,
          sortOrder:  index,
        },
      }),
    ),
  )

  // Auto-create inactive tickets for ticketable categories
  // Delete stale auto-generated (not yet activated) tickets first
  await prisma.ticket.deleteMany({
    where: { bookingId: booking.id, activated: false },
  })

  const ticketableLines = createdLines.filter(l => TICKETABLE_CATEGORIES[l.category as PNLCategory])
  if (ticketableLines.length > 0) {
    await prisma.ticket.createMany({
      data: ticketableLines.map(l => ({
        bookingId: booking.id,
        pnlLineId: l.id,
        type:      `${TICKETABLE_CATEGORIES[l.category as PNLCategory]} — ${l.activity}`,
        qty:       1,
        currency:  booking.currency ?? 'USD',
        activated: false,   // GT must activate before purchasing
        status:    'DRAFT' as const,
        notes:     `Auto-generated from P&L line: ${l.activity}`,
      })),
    })
  }

  const fullPnl = await prisma.pNL.findUnique({
    where: { id: pnl.id },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })

  return buildApiSuccess(computePNLTotals(fullPnl!), 'P&L saved')
}
