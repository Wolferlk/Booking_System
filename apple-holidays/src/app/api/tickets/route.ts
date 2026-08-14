import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission, canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import { resolvePortalSelection } from '@/lib/portals'
import { syncApprovalMirror } from '@/lib/ticket-approvals'
import type { UserRole, OperationCountry } from '@prisma/client'

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

  const where: Record<string, unknown> = {}
  if (bookingRef) {
    const booking = await prisma.booking.findUnique({ where: { bookingRef } })
    if (booking) where.bookingId = booking.id
  } else if (effectiveCountry) {
    where.booking = { operationCountry: { in: countryScope(effectiveCountry)! } }
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      booking: { select: { bookingRef: true, arrivalDate: true } },
      agendaItem: { select: { date: true, location: true, toPoint: true } },
      pnlLine: {
        select: {
          activity: true, paymentStatus: true, paymentRefNumber: true, category: true,
          mmtRate: true, sicRate: true, pvtRatePP: true,
          adEntrance: true, chEntrance: true, otherRate: true,
          pnl: { select: { paxAdults: true, paxChildren: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Bring Accounts' answers across before the list is drawn, so an approval or
  // a payment that landed a minute ago shows without anyone pressing anything.
  // Only worth doing for tickets actually in the queue — and only when the list
  // is small enough that a booking's worth of state costs one round trip. A
  // country-wide list skips it and reads the mirror as it stands.
  const inQueue = tickets.filter(t => t.approvalStatus === 'pending' || t.approvalStatus === 'approved')

  if (inQueue.length && inQueue.length <= 60) {
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

  return buildApiSuccess(tickets)
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

  return buildApiSuccess(ticket, 'Ticket created')
}
