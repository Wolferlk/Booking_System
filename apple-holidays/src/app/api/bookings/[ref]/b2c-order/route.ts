/**
 * GET → the Aahaas store's own figures for a B2C booking: order value, product
 * total, paid and balance in the order currency AND the base currency at the
 * order-day rate, how the order was placed (AI WhatsApp, AI Voice, …), the
 * guest's real contact, and where to get the invoice.
 *
 * Read-only against the store (`b2c-order-money.ts`); nothing is written here
 * or in OPS. Same auth and country scope as Update Booking.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchB2cOrderMoney } from '@/lib/b2c-order-money'
import { b2cInvoiceNo } from '@/lib/b2c-invoice-html'
import { guestContact, loadB2cBookingForOrder } from '@/lib/b2c-order-access'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const gate = await loadB2cBookingForOrder(params.ref, await getServerSession(authOptions))
  if ('error' in gate) return gate.error
  const { booking } = gate

  try {
    const money = await fetchB2cOrderMoney(booking.orderId)
    if (!money) return buildApiError(`Order ${booking.orderId} is no longer in the Aahaas store.`, 404)
    const base = `/api/bookings/${encodeURIComponent(booking.bookingRef)}/b2c-invoice`
    return buildApiSuccess({
      ...money,
      guest: guestContact(booking, money),
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
