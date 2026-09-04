import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { portalPurchaseBlocker, resolvePortalSelection } from '@/lib/portals'
import { markApprovalPurchased, purchaseBlocker } from '@/lib/ticket-approvals'
import { directIssueEnabled } from '@/lib/ticket-direct-issue'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:purchase')) {
    return buildApiError('Forbidden', 403)
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: {
      pnlLine: true,
      booking: { select: { operationCountry: true } },
    },
  })

  if (!ticket) return buildApiError('Ticket not found', 404)

  // Both money gates below ask Accounts a question. This switch is the answer
  // "we are not asking" — read once here and honoured by G2 and G4 alike, so
  // the two can never end up disagreeing about whether Accounts is in the loop.
  const directIssue = await directIssueEnabled()

  // G2 GUARD: Cannot purchase unless the linked P&L line payment is confirmed
  if (!directIssue && ticket.pnlLine && ticket.pnlLine.paymentStatus !== 'CONFIRMED') {
    return buildApiError(
      'Cannot purchase ticket: P&L payment not yet confirmed by Accounts Team (Rule G2)',
      403,
    )
  }

  const body = await req.json().catch(() => ({}))
  const { reference } = body

  // The portal can be chosen in the purchase step itself — which is where it
  // most naturally belongs, since buying it is when you know where you bought
  // it.
  let portal
  try {
    portal = await resolvePortalSelection(ticket.booking.operationCountry, body)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'That portal could not be used.', 422)
  }

  // G3 GUARD: on the boards that buy through resellers, a purchase has to say
  // which one. Accounts pays the portal named here; with none it pays whichever
  // portal the supplier is usually paid through, which is a guess about
  // somebody else's money.
  const blocker = portalPurchaseBlocker(ticket.booking.operationCountry, {
    category: ticket.category,
    portalName: portal ? portal.portalName : ticket.portalName,
  })
  if (blocker) return buildApiError(blocker, 422)

  // G4 GUARD: on MY/SG/VN an attraction ticket is approved and paid for by
  // Accounts *before* it is bought. This is the gate that enforces that order —
  // it reads the shared approval row live rather than the mirrored column, and
  // an Accounts database it cannot reach blocks the purchase rather than
  // waving it through. Sri Lanka and non-ticket categories are exempt: their
  // driver buys out of an advance he already holds. Direct issuing stands the
  // gate down entirely — and skips the cross-database round trip with it,
  // rather than making one only to ignore the answer.
  const approvalBlocker = directIssue
    ? null
    : await purchaseBlocker(ticket.booking.operationCountry, {
        id: ticket.id,
        category: ticket.category,
      })
  if (approvalBlocker) return buildApiError(approvalBlocker, 422)

  const updated = await prisma.ticket.update({
    where: { id: params.id },
    data: {
      status: 'PURCHASED',
      purchasedAt: new Date(),
      reference: reference || null,
      ...(portal && {
        portalId: portal.portalId,
        portalName: portal.portalName,
        portalRef: portal.portalRef ?? null,
        portalBy: session.user.name || session.user.email || null,
        portalAt: new Date(),
      }),
    },
  })

  // Close the loop for Accounts: they paid a portal for this ticket, and this
  // is what tells them it turned into a purchase. Best-effort by design — the
  // purchase above is already recorded and must not fail on a stamp.
  await markApprovalPurchased(updated.id, updated.reference)

  return buildApiSuccess(
    updated,
    updated.portalName
      ? `Ticket purchased through ${updated.portalName} — Accounts has already paid that portal.`
      : 'Ticket marked as purchased',
  )
}
