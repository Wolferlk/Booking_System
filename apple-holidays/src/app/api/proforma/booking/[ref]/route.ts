/**
 * GET /api/proforma/booking/:ref — one booking, its hotels, and every proforma
 * filed against them, each carrying whatever Accounts has done with it.
 *
 * `:ref` is a control number, an IS number, or a booking id — whichever the
 * search handed back.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import {
  buildHotelSlots, invoicesForBooking, refKey, searchBookings, toProformaRow,
} from '@/lib/proforma'
import { settlementsFor } from '@/lib/accounts-proforma-db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const g = await guardReservation('proforma:read')
  if (!g.ok) return g.response

  const ref = decodeURIComponent(params.ref ?? '').trim()
  if (!ref) return buildApiError('No booking reference given', 422)

  const booking = await prisma.booking.findFirst({
    where: { OR: [{ id: ref }, { bookingRef: ref }, { isNumber: ref }] },
    select: {
      id: true, bookingRef: true, isNumber: true, agent: true, agentEmail: true,
      status: true, operationCountry: true, arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, currency: true, quotedTotal: true,
      dealName: true, tourDestination: true, fileHandler: true,
      passengers: { select: { fullName: true }, orderBy: { id: 'asc' }, take: 1 },
      accommodations: {
        select: {
          id: true, hotel: true, city: true, checkIn: true, checkOut: true,
          nights: true, roomType: true, mealType: true, ownArrangement: true,
        },
        orderBy: { checkIn: 'asc' },
      },
    },
  })

  // Not found by an exact key — fall back to the same normalised search the
  // lookup box uses, so "IS 48525" reaches a booking stored as "IS48525".
  if (!booking) {
    const [hit] = await searchBookings(ref, 1)
    if (!hit) return buildApiError(`No booking found for "${ref}"`, 404)
    return GET(_req, { params: { ref: hit.id } })
  }

  if (g.session.countries) {
    if (!booking.operationCountry || !g.session.countries.includes(booking.operationCountry)) {
      return buildApiError('That booking is outside your country scope', 403)
    }
  }

  const invoiceRows = await invoicesForBooking(booking)
  const invoices = invoiceRows.map(toProformaRow)

  const settlements = await settlementsFor(invoices.map(i => i.id))
  for (const inv of invoices) inv.settlement = settlements.get(inv.id) ?? null

  const slots = buildHotelSlots(booking.accommodations, invoices)

  return buildApiSuccess({
    booking: {
      id: booking.id,
      bookingRef: booking.bookingRef,
      isNumber: booking.isNumber,
      refKey: refKey(booking.bookingRef),
      agent: booking.agent,
      agentEmail: booking.agentEmail,
      status: booking.status,
      operationCountry: booking.operationCountry,
      arrivalDate: booking.arrivalDate.toISOString(),
      departureDate: booking.departureDate.toISOString(),
      paxAdults: booking.paxAdults,
      paxChildren: booking.paxChildren,
      currency: booking.currency,
      quotedTotal: booking.quotedTotal == null ? null : Number(booking.quotedTotal),
      leadGuest: booking.passengers[0]?.fullName ?? null,
      dealName: booking.dealName,
      tourDestination: booking.tourDestination,
      fileHandler: booking.fileHandler,
    },
    hotels: slots,
    invoices,
    canManage: hasPermission(g.session.role as UserRole, 'proforma:manage'),
  })
}
