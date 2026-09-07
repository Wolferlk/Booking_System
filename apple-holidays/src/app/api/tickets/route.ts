import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission, canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import { resolvePortalSelection } from '@/lib/portals'
import { syncApprovalMirror } from '@/lib/ticket-approvals'
import type { UserRole, OperationCountry, Prisma } from '@prisma/client'
import { clearNoTicketsMark } from '@/lib/no-tickets-clear'
import {
  parseTicketFilters, buildTicketWhere, applyStatusFilter,
  buildOrderBy, STATUS_CLAUSE, TICKET_LIST_INCLUDE,
} from '@/lib/ticket-filters'

/**
 * Page size ceiling. The list used to read every ticket in the country —
 * ~41k rows with their bookings and P&L lines attached — on every visit, which
 * is a lot of live database for one screen. Filtering and paging happen in SQL
 * now; this caps what a hand-edited URL can ask for in one go.
 */
const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 50

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const userCountry = session.user.country as OperationCountry | undefined
  const { searchParams } = req.nextUrl
  const bookingRef = searchParams.get('bookingRef')
  const countryOverride = searchParams.get('country') as OperationCountry | null

  const effectiveCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? (countryOverride || null)
    : (userCountry || null)

  // ── one booking's tickets ────────────────────────────────────────────────
  // The booking pages, the print views and the P&L panels all ask this way and
  // expect the whole list back as a plain array. Left exactly as it was.
  if (bookingRef) {
    const booking = await prisma.booking.findUnique({ where: { bookingRef } })
    const tickets = await prisma.ticket.findMany({
      where: booking ? { bookingId: booking.id } : {},
      include: TICKET_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    await refreshApprovals(tickets)
    return buildApiSuccess(tickets)
  }

  // ── filtered, paged list ─────────────────────────────────────────────────
  const filters = parseTicketFilters(searchParams)
  const baseWhere = buildTicketWhere(filters, effectiveCountry)
  const where = applyStatusFilter(baseWhere, filters.status)

  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE),
  )

  const [total, tickets] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: TICKET_LIST_INCLUDE,
      orderBy: buildOrderBy(filters.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  await refreshApprovals(tickets)

  // Tab counts are measured against every filter *except* the tab, so the
  // numbers describe the list the user would get by clicking each one. Opt-in,
  // because a page-turn does not change them.
  const stats = searchParams.get('stats') === '1'
    ? await collectStats(baseWhere)
    : undefined

  return Response.json({
    success: true,
    data: tickets,
    meta: {
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      ...(stats ? { stats } : {}),
    },
  })
}

/**
 * Bring Accounts' answers across before the list is drawn, so an approval or a
 * payment that landed a minute ago shows without anyone pressing anything.
 * Only worth doing for tickets actually in the queue, and only for a page's
 * worth — the mirror on the row is what a bigger list reads.
 */
async function refreshApprovals(
  tickets: { id: string; approvalStatus: string | null }[],
): Promise<void> {
  const inQueue = tickets.filter(t => t.approvalStatus === 'pending' || t.approvalStatus === 'approved')
  if (!inQueue.length || inQueue.length > 60) return

  const fresh = await syncApprovalMirror(inQueue.map(t => t.id))

  for (const ticket of tickets) {
    const a = fresh.get(ticket.id)
    if (!a) continue

    // The rows were read before the refresh; patch what moved rather than
    // querying the whole list again.
    Object.assign(ticket, {
      approvalStatus:    a.status,
      approvalUrgency:   a.urgency,
      approvalDecidedBy: a.decidedBy,
      approvalDecidedAt: a.decidedAt ? new Date(a.decidedAt) : null,
      approvalNote:      a.decisionNote,
      approvalPaidAt:    a.paidAt ? new Date(a.paidAt) : null,
      approvalPaidRef:   a.paidReference,
    })
  }
}

/** Per-tab counts plus the money the current filter is sitting on. */
async function collectStats(base: Prisma.TicketWhereInput) {
  const countWith = (clause: Prisma.TicketWhereInput | null) =>
    prisma.ticket.count({ where: clause ? { AND: [base, clause] } : base })

  const [all, pendingActivation, active, purchased, issued, notIssued, awaitingApproval, money] =
    await Promise.all([
      countWith(null),
      countWith(STATUS_CLAUSE.pending_activation),
      countWith(STATUS_CLAUSE.active),
      countWith(STATUS_CLAUSE.purchased),
      countWith(STATUS_CLAUSE.issued),
      countWith(STATUS_CLAUSE.not_issued),
      countWith(STATUS_CLAUSE.awaiting_approval),
      prisma.ticket.aggregate({
        where: base,
        _sum: { totalCost: true, qty: true },
      }),
    ])

  return {
    all, pendingActivation, active, purchased, issued, notIssued, awaitingApproval,
    totalCost: money._sum.totalCost ? Number(money._sum.totalCost) : 0,
    totalQty: money._sum.qty ?? 0,
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:create')) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json()
  const { bookingRef, agendaItemId, pnlLineId, type, qty, supplier, costPerUnit, currency, notes, category } = body

  if (!bookingRef || !type) return buildApiError('bookingRef and type are required')

  const booking = await prisma.booking.findUnique({ where: { bookingRef } })
  if (!booking) return buildApiError('Booking not found', 404)

  const totalCost = costPerUnit ? Number(costPerUnit) * Number(qty ?? 1) : null

  // Where it is being bought, when the ground team already knows. Validated
  // against the shared registry rather than stored as typed — Accounts matches
  // portals by name, so a misspelling here is a payment it cannot route.
  let portal
  try {
    portal = await resolvePortalSelection(booking.operationCountry, body)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'That portal could not be used.', 422)
  }

  const ticket = await prisma.ticket.create({
    data: {
      bookingId: booking.id,
      agendaItemId: agendaItemId || null,
      pnlLineId: pnlLineId || null,
      type,
      qty: Number(qty ?? 1),
      supplier,
      costPerUnit: costPerUnit ? Number(costPerUnit) : null,
      totalCost,
      currency: currency ?? 'USD',
      notes,
      ...(category != null && { category: category || null }),
      ...(portal && {
        portalId: portal.portalId,
        portalName: portal.portalName,
        portalRef: portal.portalRef ?? null,
        portalBy: portal.portalName ? (session.user.name || session.user.email || null) : null,
        portalAt: portal.portalName ? new Date() : null,
      }),
      status: 'DRAFT',
    },
  })

  // The booking now has a ticket, so a standing "No Tickets" mark is no longer true.
  await clearNoTicketsMark(booking.id)

  return buildApiSuccess(ticket, 'Ticket created')
}
