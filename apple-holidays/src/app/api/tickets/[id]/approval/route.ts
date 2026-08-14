import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import {
  approvalForTicket,
  approvalRequiredFor,
  approvalRequiredForCategory,
  submitForApproval,
  withdrawApproval,
} from '@/lib/ticket-approvals'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * One ticket's approval request — raise it, read it, take it back.
 *
 * This is the step that now stands between a ticket and its purchase on
 * Malaysia, Singapore and Vietnam. The ground team picks the portal it means to
 * buy through, sends the ticket over, and Accounts approves it and pays that
 * portal; only then does the purchase route let the ticket be bought.
 *
 * The request itself lives in the Accounts database — see lib/ticket-approvals.
 */

/** Reading the state is not an action; anyone who can see the ticket can. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { id } = await params

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      id: true, type: true, category: true, portalName: true,
      booking: { select: { operationCountry: true } },
    },
  })
  if (!ticket) return buildApiError('Ticket not found', 404)

  try {
    const approval = await approvalForTicket(id)

    return buildApiSuccess({
      approval,
      required: approvalRequiredFor(ticket.booking.operationCountry)
        && approvalRequiredForCategory(ticket.category),
      portalName: ticket.portalName,
    })
  } catch (err) {
    // The Accounts database is a separate server; a blip must not break the
    // ticket card. "Unknown" is reported honestly rather than as "not
    // submitted", which would invite someone to submit it twice.
    return buildApiError(
      'The Accounts system could not be reached, so this ticket’s approval state is unknown.',
      503,
    )
  }
}

/**
 * Submit the ticket to Accounts for approval.
 *
 * Body: { urgent?: boolean, urgentReason?: string, neededBy?: string, note?: string }
 *
 * An urgent request raises the emergency alert on the Accounts topbar and pins
 * itself to the top of their board, so it carries a reason — that is enforced
 * in submitBlocker(), not here, because the same rule has to hold for every
 * caller.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  // Submitting commits us to a purchase in front of Accounts, so it takes the
  // same permission as making the purchase itself.
  if (!hasPermission(role, 'ticket:purchase')) return buildApiError('Forbidden', 403)

  const { id } = await params

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      agendaItem: { select: { date: true } },
      booking: {
        select: {
          id: true, bookingRef: true, isNumber: true, cntlNumber: true,
          operationCountry: true, arrivalDate: true,
          // The name Accounts recognises the booking by on their card. The
          // lead passenger, or whoever is first on the file if nobody is
          // flagged as lead.
          passengers: {
            select: { name: true },
            orderBy: { isLead: 'desc' },
            take: 1,
          },
        },
      },
    },
  })
  if (!ticket) return buildApiError('Ticket not found', 404)

  if (ticket.status !== 'DRAFT') {
    return buildApiError('This ticket has already been bought — there is nothing left to approve.', 422)
  }

  const body = await req.json().catch(() => ({}))
  const actor = session.user.name || session.user.email || 'operations'

  try {
    const approval = await submitForApproval(
      {
        id: ticket.id,
        type: ticket.type,
        category: ticket.category,
        qty: ticket.qty,
        totalCost: ticket.totalCost,
        currency: ticket.currency,
        portalId: ticket.portalId,
        portalName: ticket.portalName,
        portalRef: ticket.portalRef,
        booking: {
          ...ticket.booking,
          clientName: ticket.booking.passengers[0]?.name ?? null,
        },
        agendaDate: ticket.agendaItem?.date ?? null,
      },
      actor,
      {
        urgent: Boolean(body.urgent),
        urgentReason: body.urgentReason ?? null,
        neededBy: body.neededBy ?? null,
        note: body.note ?? null,
      },
    )

    return buildApiSuccess(
      approval,
      approval.urgency === 'urgent'
        ? `Sent to Accounts as URGENT — they have been alerted. ${approval.portalName} will be paid once approved.`
        : `Sent to Accounts. You can buy this once they have paid ${approval.portalName}.`,
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'The request could not be sent.', 422)
  }
}

/** Take a pending request back — before Accounts has answered it, only. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:purchase')) return buildApiError('Forbidden', 403)

  const { id } = await params
  const actor = session.user.name || session.user.email || 'operations'

  try {
    const approval = await withdrawApproval(id, actor)

    return buildApiSuccess(approval, 'Request withdrawn. Fix what you need to and send it again.')
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'The request could not be withdrawn.', 422)
  }
}
