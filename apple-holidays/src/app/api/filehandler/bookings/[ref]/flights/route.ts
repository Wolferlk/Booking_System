import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'

export const dynamic = 'force-dynamic'

interface FlightInput {
  flightNo: string
  date: string
  fromApt: string
  depTime: string
  toApt: string
  arrTime: string
  airline?: string
  notes?: string
}

function validate(f: Partial<FlightInput>): string | null {
  if (!f.flightNo?.trim()) return 'Flight number is required'
  if (!f.date)             return 'Flight date is required'
  if (!f.fromApt?.trim())  return 'Departure airport is required'
  if (!f.toApt?.trim())    return 'Arrival airport is required'
  return null
}

async function loadBooking(ref: string) {
  return prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: {
      id: true, bookingRef: true, isNumber: true, cntlNumber: true,
      operationCountry: true, fileHandler: true,
    },
  })
}

/** Log a flight action to the audit trail — also the /view Live Screen feed. */
async function logFlight(
  handler: { id: string; name: string },
  booking: { id: string; bookingRef: string; isNumber: string | null; cntlNumber: string | null; operationCountry: string | null },
  action: 'FLIGHT_ADDED' | 'FLIGHT_UPDATED',
  details: string,
) {
  await prisma.fileHandlerLog.create({
    data: {
      fileHandlerId: handler.id,
      fileHandlerName: handler.name,
      action,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      isNumber: booking.isNumber,
      cntlNumber: booking.cntlNumber,
      operationCountry: booking.operationCountry as never,
      details,
    },
  })
  // Stamp the handler onto the booking so ops staff can see who owns flights.
  await prisma.booking.updateMany({
    where: { id: booking.id, OR: [{ fileHandler: null }, { fileHandler: '' }] },
    data: { fileHandler: handler.name },
  })
}

// POST — add a flight to the booking
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const body = await req.json().catch(() => ({})) as FlightInput
  const err = validate(body)
  if (err) return buildApiError(err)

  const flight = await prisma.flight.create({
    data: {
      bookingId: booking.id,
      flightNo: body.flightNo.trim(),
      date: new Date(body.date),
      fromApt: body.fromApt.trim(),
      depTime: (body.depTime ?? '').trim(),
      toApt: body.toApt.trim(),
      arrTime: (body.arrTime ?? '').trim(),
      airline: body.airline?.trim() || null,
      notes: body.notes?.trim() || null,
    },
  })

  await logFlight(handler, booking, 'FLIGHT_ADDED', `Added flight ${flight.flightNo} (${flight.fromApt}→${flight.toApt})`)
  return buildApiSuccess(flight, 'Flight added')
}

// PUT — edit an existing flight (?flightId=)
export async function PUT(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const flightId = req.nextUrl.searchParams.get('flightId')
  if (!flightId) return buildApiError('flightId is required')

  const body = await req.json().catch(() => ({})) as FlightInput
  const err = validate(body)
  if (err) return buildApiError(err)

  const existing = await prisma.flight.findFirst({ where: { id: flightId, bookingId: booking.id } })
  if (!existing) return buildApiError('Flight not found on this booking', 404)

  const flight = await prisma.flight.update({
    where: { id: flightId },
    data: {
      flightNo: body.flightNo.trim(),
      date: new Date(body.date),
      fromApt: body.fromApt.trim(),
      depTime: (body.depTime ?? '').trim(),
      toApt: body.toApt.trim(),
      arrTime: (body.arrTime ?? '').trim(),
      airline: body.airline?.trim() || null,
      notes: body.notes?.trim() || null,
    },
  })

  await logFlight(handler, booking, 'FLIGHT_UPDATED', `Updated flight ${flight.flightNo} (${flight.fromApt}→${flight.toApt})`)
  return buildApiSuccess(flight, 'Flight updated')
}

// DELETE — remove a flight (?flightId=)
export async function DELETE(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const flightId = req.nextUrl.searchParams.get('flightId')
  if (!flightId) return buildApiError('flightId is required')

  const existing = await prisma.flight.findFirst({ where: { id: flightId, bookingId: booking.id } })
  if (!existing) return buildApiError('Flight not found on this booking', 404)

  await prisma.flight.delete({ where: { id: flightId } })
  await logFlight(handler, booking, 'FLIGHT_UPDATED', `Removed flight ${existing.flightNo}`)
  return buildApiSuccess(null, 'Flight removed')
}
