import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { portalPurchaseBlocker, resolvePortalSelection } from '@/lib/portals'
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

  // G2 GUARD: Cannot purchase unless the linked P&L line payment is confirmed
  if (ticket.pnlLine && ticket.pnlLine.paymentStatus !== 'CONFIRMED') {
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

  return buildApiSuccess(
    updated,
    updated.portalName
      ? `Ticket purchased through ${updated.portalName} — Accounts will pay that portal.`
      : 'Ticket marked as purchased',
  )
}
