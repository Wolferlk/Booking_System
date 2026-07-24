import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'
import { normalizeIsNumber } from '@/lib/as-booking-map'

export const dynamic = 'force-dynamic'

/** Booking `select` shared by search and AS import so both return the same shape. */
export const FH_BOOKING_SELECT = {
  id: true, bookingRef: true, isNumber: true, cntlNumber: true, agent: true,
  fileHandler: true, status: true, operationCountry: true,
  arrivalDate: true, departureDate: true,
  paxAdults: true, paxChildren: true, paxInfants: true,
  cancelRequestedAt: true, cancelledByName: true, cancellationReason: true,
  passengers: { where: { isLead: true }, take: 1, select: { name: true } },
  flights: {
    orderBy: { date: 'asc' as const },
    select: {
      id: true, flightNo: true, date: true, fromApt: true, depTime: true,
      toApt: true, arrTime: true, airline: true, notes: true,
    },
  },
} as const

/**
 * File-handler booking lookup. Handlers may search ALL countries (per product
 * decision) by Booking ref, IS number, or CNTL number. Returns the booking with
 * its flights and lead passenger — everything the portal needs to add flight
 * details or raise a cancellation.
 */
export async function GET(req: NextRequest) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return buildApiError('Enter a Booking ref, IS number, or CNTL number')

  // Space-insensitive: "IS 40475" and "IS40475" are the same booking. We match
  // both the raw input and its normalised form (spaces stripped, upper-cased).
  const qn = normalizeIsNumber(q)
  const terms = Array.from(new Set([q, qn].filter(Boolean)))

  const bookings = await prisma.booking.findMany({
    where: {
      OR: terms.flatMap(t => [
        { bookingRef: { equals: t } },
        { isNumber:   { equals: t } },
        { cntlNumber: { equals: t } },
        { bookingRef: { contains: t } },
        { isNumber:   { contains: t } },
        { cntlNumber: { contains: t } },
      ]),
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: FH_BOOKING_SELECT,
  })

  return buildApiSuccess({ results: bookings })
}
