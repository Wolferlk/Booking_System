/**
 * PATCH /api/reservations/invoices/:id — verify, forward, reject or mark paid.
 *
 * Forwarding is the hand-off to Accounts: this team verifies the paper, but
 * `AC_USER` releases the money. Marking an invoice PAID therefore needs the
 * Accounts-side permission, not the reservation one.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertBookingInScope } from '@/lib/reservation-guard'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

const ALLOWED = ['UNDER_REVIEW', 'DISCREPANCY', 'VERIFIED', 'FORWARDED', 'PAID', 'REJECTED', 'VOID']

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('invoice:read')
  if (!g.ok) return g.response

  const body = await req.json()
  const next = body.status as string | undefined
  if (next && !ALLOWED.includes(next)) return buildApiError(`Unknown status ${next}`, 422)

  const invoice = await prisma.proformaInvoice.findUnique({ where: { id: params.id } })
  if (!invoice) return buildApiError('Invoice not found', 404)
  if (invoice.bookingRef && !(await assertBookingInScope(invoice.bookingRef, g.session))) {
    return buildApiError('Invoice is outside your country scope', 403)
  }

  const role = g.session.role as UserRole
  if ((next === 'VERIFIED' || next === 'REJECTED') && !hasPermission(role, 'invoice:verify')) {
    return buildApiError('You may not verify invoices', 403)
  }
  if (next === 'FORWARDED' && !hasPermission(role, 'invoice:forward')) {
    return buildApiError('You may not forward invoices to Accounts', 403)
  }
  // Payment is released by Accounts, never by the Reservation Team.
  if (next === 'PAID' && !hasPermission(role, 'pnl:confirm_payment')) {
    return buildApiError('Only Accounts may mark an invoice paid', 403)
  }
  if (next === 'REJECTED' && !body.rejectReason?.trim()) {
    return buildApiError('A reason is required to reject an invoice', 422)
  }

  const now = new Date()
  const updated = await prisma.$transaction(async tx => {
    const row = await tx.proformaInvoice.update({
      where: { id: params.id },
      data: {
        ...(next ? { status: next as never } : {}),
        ...(next === 'VERIFIED' ? { verifiedAt: now, verifiedBy: g.session.actor.email ?? null } : {}),
        ...(next === 'FORWARDED' ? { forwardedAt: now, forwardedTo: body.forwardedTo ?? 'Accounts' } : {}),
        ...(next === 'PAID' ? { paidAt: now } : {}),
        ...(next === 'REJECTED' ? { rejectReason: body.rejectReason } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        updatedBy: g.session.actor.email ?? null,
      },
    })

    // A paid proforma settles the stay it belongs to.
    if (next === 'PAID' && row.reservationId) {
      await tx.hotelReservation.update({
        where: { id: row.reservationId },
        data: { paidAt: now },
      })
    }

    if (row.reservationId && next) {
      await tx.reservationEvent.create({
        data: {
          reservationId: row.reservationId,
          action: 'invoice_status',
          toStatus: next,
          note: body.rejectReason ?? body.notes ?? null,
          actorName: g.session.actor.name ?? null,
          actorEmail: g.session.actor.email ?? null,
        },
      })
    }

    return row
  })

  return buildApiSuccess(updated)
}
