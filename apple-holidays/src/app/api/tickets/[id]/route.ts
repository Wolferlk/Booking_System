import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolvePortalSelection } from '@/lib/portals'
import { withdrawApproval } from '@/lib/ticket-approvals'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
const CAN_EDIT: UserRole[] = ['GT_USER', 'GT_VN_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { id } = await params
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      booking: { select: { bookingRef: true, arrivalDate: true, agent: true } },
      agendaItem: { select: { date: true, location: true } },
      pnlLine: {
        select: {
          activity: true, paymentStatus: true, paymentRefNumber: true, category: true,
          mmtRate: true, sicRate: true, pvtRatePP: true,
          adEntrance: true, chEntrance: true, otherRate: true,
          pnl: { select: { paxAdults: true, paxChildren: true } },
        },
      },
    },
  })
  if (!ticket) return buildApiError('Ticket not found', 404)
  return buildApiSuccess(ticket)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!CAN_EDIT.includes(role)) return buildApiError('Forbidden', 403)

  const { id } = await params
  const existing = await prisma.ticket.findUnique({ where: { id } })
  if (!existing) return buildApiError('Ticket not found', 404)

  // Deleting a ticket Accounts has already committed money to would leave them
  // paying for something with no record on this side of what it was.
  if (existing.approvalStatus === 'approved' || existing.approvalStatus === 'paid') {
    return buildApiError(
      `Accounts has ${existing.approvalStatus === 'paid' ? 'paid for' : 'approved'} this ticket. `
      + 'Ask them to reverse it before deleting the ticket.',
      422,
    )
  }

  // A request still waiting for a decision is taken back first, so nobody
  // approves a ticket that no longer exists.
  if (existing.approvalStatus === 'pending') {
    try {
      await withdrawApproval(id, session.user.name || session.user.email || 'operations')
    } catch (err) {
      return buildApiError(
        'The approval request could not be withdrawn, so the ticket was left in place. '
        + (err instanceof Error ? err.message : ''),
        422,
      )
    }
  }

  await prisma.ticket.delete({ where: { id } })
  return buildApiSuccess(null, 'Ticket deleted')
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!CAN_EDIT.includes(role)) return buildApiError('Forbidden', 403)

  const { id } = await params
  const existing = await prisma.ticket.findUnique({
    where: { id },
    include: { booking: { select: { operationCountry: true } } },
  })
  if (!existing) return buildApiError('Ticket not found', 404)

  const body = await req.json()

  // A ticket that is with Accounts is frozen on the things they are deciding
  // about: what is being bought, for how much, and from whom. Accounts approved
  // paying *this* portal *this* amount, and letting the ground team edit either
  // afterwards would turn their decision into a signature on a blank page.
  //
  // Read from the mirrored column rather than the shared table: it is written
  // on every submission and refreshed on every read, and being one refresh
  // behind can only make this guard stricter, never laxer.
  const LOCKED_WHILE = ['pending', 'approved', 'paid']
  if (existing.approvalStatus && LOCKED_WHILE.includes(existing.approvalStatus)) {
    const touchesPortal = body.portalId !== undefined || body.portalName !== undefined
    const touchesMoney = body.costPerUnit !== undefined || body.qty !== undefined
      || body.currency !== undefined || body.type !== undefined

    if (touchesPortal || touchesMoney) {
      return buildApiError(
        existing.approvalStatus === 'pending'
          ? 'This ticket is with Accounts for approval. Withdraw the request first if you need to change '
            + 'the portal, the price or what is being bought.'
          : `Accounts has already ${existing.approvalStatus === 'paid' ? 'paid for' : 'approved'} this ticket — `
            + 'the portal and the amount cannot be changed now. Talk to Accounts.',
        422,
      )
    }
  }

  const {
    type, supplier, qty, costPerUnit, currency, reference, notes,
    category, transferType, vehicleType, vehicleNumber, driverName, driverPhone,
    fileUrl, fileName, fileType,
  } = body

  // The portal this was (or will be) bought through. Resolved against the
  // shared registry so the name stored is one Accounts can match; left alone
  // entirely when the request does not mention it.
  let portal
  try {
    portal = await resolvePortalSelection(existing.booking.operationCountry, body)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'That portal could not be used.', 422)
  }

  const parsedQty  = qty  != null ? Number(qty)  : undefined
  const parsedCost = costPerUnit != null ? (costPerUnit === '' ? null : Number(costPerUnit)) : undefined
  const totalCost  = parsedCost != null && parsedQty != null
    ? parsedCost * parsedQty
    : parsedCost != null
      ? parsedCost * existing.qty
      : parsedQty != null && existing.costPerUnit != null
        ? Number(existing.costPerUnit) * parsedQty
        : undefined

  const ticket = await prisma.ticket.update({
    where: { id },
    data: {
      ...(type         != null && { type }),
      ...(supplier     != null && { supplier: supplier || null }),
      ...(parsedQty    != null && { qty: parsedQty }),
      ...(parsedCost   !== undefined && { costPerUnit: parsedCost }),
      ...(totalCost    !== undefined && { totalCost }),
      ...(currency     != null && { currency }),
      ...(reference    != null && { reference: reference || null }),
      ...(notes        != null && { notes: notes || null }),
      ...(category     != null && { category: category || null }),
      ...(transferType != null && { transferType: transferType || null }),
      ...(vehicleType  != null && { vehicleType: vehicleType || null }),
      ...(vehicleNumber!= null && { vehicleNumber: vehicleNumber || null }),
      ...(driverName   != null && { driverName: driverName || null }),
      ...(driverPhone  != null && { driverPhone: driverPhone || null }),
      ...(fileUrl      != null && { fileUrl: fileUrl || null }),
      ...(fileName     != null && { fileName: fileName || null }),
      ...(fileType     != null && { fileType: fileType || null }),
      // Who recorded the portal, and when — stamped only when the portal
      // actually changes, so an unrelated edit does not rewrite the history of
      // a purchase someone else made.
      ...(portal && {
        portalId: portal.portalId,
        portalName: portal.portalName,
        portalRef: portal.portalRef ?? null,
        ...(portal.portalName !== existing.portalName && {
          portalBy: portal.portalName ? (session.user.name || session.user.email || null) : null,
          portalAt: portal.portalName ? new Date() : null,
        }),
      }),
    },
    include: {
      booking: { select: { bookingRef: true } },
      pnlLine: { select: { activity: true, paymentStatus: true, paymentRefNumber: true, category: true } },
    },
  })

  return buildApiSuccess(ticket, 'Ticket updated')
}
