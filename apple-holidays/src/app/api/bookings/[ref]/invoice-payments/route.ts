/**
 * GET /api/bookings/[ref]/invoice-payments
 *
 * This booking's client invoice and its payment ledger, read live out of the
 * accounts database. Both systems share one MySQL instance, so nothing is
 * copied or cached on the OPS side and nothing here writes — the accounts
 * system remains the only author of an invoice or a receipt.
 *
 * A booking accounts has not invoiced yet answers `{ available: false }` with a
 * reason rather than a 404: that is an ordinary state for a new booking, and
 * the panel says so in words instead of showing an error. A 502 is reserved for
 * the database genuinely being unreachable, which is a different problem and
 * has to look different on screen.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { fetchInvoiceLedger } from '@/lib/accounts-invoice-db'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  // Whoever may open the booking may see what the client has paid for it — this
  // is the client's own money, not supplier cost.
  const role = session.user.role as UserRole
  if (!hasPermission(role, 'booking:read')) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { bookingRef: true, isNumber: true, cntlNumber: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  try {
    const ledger = await fetchInvoiceLedger({
      reference: booking.bookingRef,
      isNumber: booking.isNumber,
      controlNumber: booking.cntlNumber,
    })

    if (!ledger) {
      return buildApiSuccess({
        available: false,
        reason: 'no_invoice',
        message: 'The accounts system has not raised an invoice for this booking yet.',
      })
    }

    return buildApiSuccess({ available: true, ledger })
  } catch (err) {
    console.error('[invoice-payments] Accounts DB read failed:', err)
    return buildApiError('Could not reach the accounts database. Try again in a moment.', 502)
  }
}
