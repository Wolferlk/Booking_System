import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'

export const dynamic = 'force-dynamic'

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

  const bookings = await prisma.booking.findMany({
    where: {
      OR: [
        { bookingRef: { equals: q } },
        { isNumber:   { equals: q } },
        { cntlNumber: { equals: q } },
        { bookingRef: { contains: q } },
        { isNumber:   { contains: q } },
        { cntlNumber: { contains: q } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true, bookingRef: true, isNumber: true, cntlNumber: true, agent: true,
      fileHandler: true, status: true, operationCountry: true,
      arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, paxInfants: true,
      cancelRequestedAt: true, cancelledByName: true, cancellationReason: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
      flights: {
        orderBy: { date: 'asc' },
        select: {
          id: true, flightNo: true, date: true, fromApt: true, depTime: true,
          toApt: true, arrTime: true, airline: true, notes: true,
        },
      },
    },
  })

  return buildApiSuccess({ results: bookings })
}
