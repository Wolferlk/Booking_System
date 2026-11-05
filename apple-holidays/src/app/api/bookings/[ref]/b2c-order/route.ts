/**
 * GET → the Aahaas store's own figures for a B2C booking: order value, product
 * total, paid and balance in the order currency AND the base currency at the
 * order-day rate, how the order was placed (AI WhatsApp, AI Voice, …), the
 * guest's real contact, and where to get the invoice.
 *
 * Read-only against the store (`b2c-order-money.ts`). The one OPS write: a
 * booking that still holds the desk's inbox, or no phone, takes the guest's
 * e-ticket contact (`repairB2cGuestContact` — fills blanks / replaces a staff
 * inbox only). Same auth and country scope as Update Booking.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchB2cOrderMoney } from '@/lib/b2c-order-money'
import { b2cInvoiceNo } from '@/lib/b2c-invoice-html'
import { guestContact, loadB2cBookingForOrder } from '@/lib/b2c-order-access'
import { repairB2cGuestContact } from '@/lib/b2c-guest-contact'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  const gate = await loadB2cBookingForOrder(params.ref, session)
  if ('error' in gate) return gate.error
  const { booking } = gate

  try {
    const money = await fetchB2cOrderMoney(booking.orderId)
    if (!money) return buildApiError(`Order ${booking.orderId} is no longer in the Aahaas store.`, 404)
    const base = `/api/bookings/${encodeURIComponent(booking.bookingRef)}/b2c-invoice`

    // Best-effort: a failed repair must never cost the panel its figures.
    const repair = money.ticketContact
      ? await repairB2cGuestContact({
          bookingRef: booking.bookingRef,
          email: money.ticketContact.email,
          phone: money.ticketContact.phone,
          source: 'b2c-order-panel (e-ticket contact)',
          apply: true,
          actorId: session!.user.id,
        }).catch((err) => {
          console.error('[GET /api/bookings/[ref]/b2c-order] contact repair failed:', err)
          return null
        })
      : null
    const repaired = repair?.status === 'repaired' ? repair.changes : []
    for (const c of repaired) {
      if (c.field === 'contactEmail' || c.field === 'contactPhone') booking[c.field] = c.to
    }

    return buildApiSuccess({
      ...money,
      guest: { ...guestContact(booking, money), repaired: repaired.map((c) => c.field) },
      invoice: {
        number: b2cInvoiceNo(money.orderId),
        viewUrl: base,
        pdfUrl: `${base}?format=pdf`,
        htmlDownloadUrl: `${base}?download=1`,
      },
    })
  } catch (err) {
    console.error('[GET /api/bookings/[ref]/b2c-order]', err)
    return buildApiError(`Could not read order ${booking.orderId} from the Aahaas store: ${(err as Error).message}`, 502)
  }
}
