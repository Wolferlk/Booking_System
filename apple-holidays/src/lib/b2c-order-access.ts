/**
 * Shared gate for the B2C order panel and invoice routes: signed-in staff, the
 * booking is in the user's country scope, it came from the Aahaas store, and
 * which store order it is. Same rules as `/api/bookings/[ref]/b2c-sync`.
 */
import type { Session } from 'next-auth'
import { prisma } from './prisma'
import { buildApiError } from './utils'
import { isInCountryScope, type OperationCountry } from './country-detection'
import { isB2cOriginBooking } from './b2c-booking-sync'
import { looksLikeAccountName } from './b2c-confirmed-lead'
import { isStaffEmail } from './b2c-booking-map'
import type { B2cOrderMoney } from './b2c-order-money'
import type { B2cInvoiceParties } from './b2c-invoice-html'

export interface B2cBookingForOrder {
  id: string
  bookingRef: string
  orderId: number
  contactEmail: string | null
  contactPhone: string | null
  leadName: string | null
}

export async function loadB2cBookingForOrder(
  ref: string,
  session: Session | null,
): Promise<{ booking: B2cBookingForOrder } | { error: Response }> {
  if (!session?.user) return { error: buildApiError('Unauthorized', 401) }
  if (session.user.role === 'CLIENT') return { error: buildApiError('Forbidden', 403) }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: {
      id: true, bookingRef: true, isNumber: true, agent: true, operationCountry: true,
      contactEmail: true, contactPhone: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
    },
  })
  if (!booking) return { error: buildApiError('Booking not found', 404) }

  const country = session.user.country as OperationCountry | undefined
  if (country && country !== 'ALL' && !isInCountryScope(booking.operationCountry as OperationCountry, country)) {
    return { error: buildApiError('Forbidden — this booking belongs to another country.', 403) }
  }
  if (!(await isB2cOriginBooking(booking.id, booking.agent))) {
    return { error: buildApiError('This is not an Aahaas B2C booking.', 404) }
  }

  const orderId = Number(/^\d+$/.test(booking.bookingRef) ? booking.bookingRef : booking.isNumber)
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { error: buildApiError(`Cannot tell which store order ${booking.bookingRef} came from.`, 422) }
  }

  return {
    booking: {
      id: booking.id,
      bookingRef: booking.bookingRef,
      orderId,
      contactEmail: booking.contactEmail,
      contactPhone: booking.contactPhone,
      leadName: booking.passengers[0]?.name ?? null,
    },
  }
}

/**
 * The guest's best contact: the e-ticket's address beats a staff inbox the
 * booking may still hold from before the import learned about ticket contacts.
 */
export function guestContact(booking: B2cBookingForOrder, money: B2cOrderMoney) {
  const opsEmail = booking.contactEmail?.trim() || null
  const ticketEmail = money.ticketContact?.email ?? null
  const email = opsEmail && !isStaffEmail(opsEmail) ? opsEmail : ticketEmail ?? opsEmail
  const phone = booking.contactPhone?.trim() || money.ticketContact?.phone || null
  return { email, phone, opsEmail, corrected: Boolean(email && opsEmail && email !== opsEmail) }
}

/** Bill-to and lead passenger for the invoice — same rules as AahaasFlow's `partiesOf`. */
export function invoiceParties(booking: B2cBookingForOrder, money: B2cOrderMoney): B2cInvoiceParties {
  const shared = looksLikeAccountName(money.billTo.name)
  const accountEmail = money.billTo.email && !isStaffEmail(money.billTo.email) ? money.billTo.email : null
  const guest = guestContact(booking, money)
  return {
    billTo: shared
      ? { name: 'Aahaas customer' }
      : { name: money.billTo.name || 'Aahaas customer', email: accountEmail, phone: money.billTo.phone },
    lead: { name: booking.leadName || money.billTo.name, email: guest.email, phone: guest.phone },
  }
}
