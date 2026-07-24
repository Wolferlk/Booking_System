import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'

export const dynamic = 'force-dynamic'

interface HotelInput {
  city: string; hotel: string; checkIn: string; checkOut: string
  address?: string; contact?: string; roomType?: string; mealType?: string; nights?: number
}

function nightsBetween(inIso: string, outIso: string): number {
  const a = new Date(inIso).getTime(), b = new Date(outIso).getTime()
  if (isNaN(a) || isNaN(b) || b <= a) return 1
  return Math.max(1, Math.round((b - a) / 86_400_000))
}

async function loadBooking(ref: string) {
  return prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { id: true, bookingRef: true, isNumber: true, cntlNumber: true, operationCountry: true, fileHandler: true },
  })
}

async function logHotel(
  handler: { id: string; name: string },
  b: { id: string; bookingRef: string; isNumber: string | null; cntlNumber: string | null; operationCountry: string | null; fileHandler: string | null },
  details: string,
) {
  await prisma.fileHandlerLog.create({
    data: {
      fileHandlerId: handler.id, fileHandlerName: handler.name, action: 'HOTEL_UPDATED',
      bookingId: b.id, bookingRef: b.bookingRef, isNumber: b.isNumber, cntlNumber: b.cntlNumber,
      operationCountry: b.operationCountry as never, details,
    },
  })
  if (!b.fileHandler) {
    await prisma.booking.updateMany({ where: { id: b.id, OR: [{ fileHandler: null }, { fileHandler: '' }] }, data: { fileHandler: handler.name } })
  }
}

function validate(h: Partial<HotelInput>): string | null {
  if (!h.hotel?.trim()) return 'Hotel name is required'
  if (!h.city?.trim())  return 'City is required'
  if (!h.checkIn)       return 'Check-in date is required'
  if (!h.checkOut)      return 'Check-out date is required'
  return null
}

// POST — add a hotel
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)
  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const body = await req.json().catch(() => ({})) as HotelInput
  const err = validate(body)
  if (err) return buildApiError(err)

  const acc = await prisma.accommodation.create({
    data: {
      bookingId: booking.id,
      city: body.city.trim(),
      hotel: body.hotel.trim(),
      checkIn: new Date(body.checkIn),
      checkOut: new Date(body.checkOut),
      nights: body.nights && body.nights > 0 ? body.nights : nightsBetween(body.checkIn, body.checkOut),
      address: body.address?.trim() || null,
      contact: body.contact?.trim() || null,
      roomType: body.roomType?.trim() || null,
      mealType: body.mealType?.trim() || null,
    },
  })
  await logHotel(handler, booking, `Added hotel ${acc.hotel} (${acc.city})`)
  return buildApiSuccess(acc, 'Hotel added')
}

// PUT — edit a hotel (?accId=)
export async function PUT(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)
  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const accId = req.nextUrl.searchParams.get('accId')
  if (!accId) return buildApiError('accId is required')
  const existing = await prisma.accommodation.findFirst({ where: { id: accId, bookingId: booking.id } })
  if (!existing) return buildApiError('Hotel not found on this booking', 404)

  const body = await req.json().catch(() => ({})) as HotelInput
  const err = validate(body)
  if (err) return buildApiError(err)

  const acc = await prisma.accommodation.update({
    where: { id: accId },
    data: {
      city: body.city.trim(),
      hotel: body.hotel.trim(),
      checkIn: new Date(body.checkIn),
      checkOut: new Date(body.checkOut),
      nights: body.nights && body.nights > 0 ? body.nights : nightsBetween(body.checkIn, body.checkOut),
      address: body.address?.trim() || null,
      contact: body.contact?.trim() || null,
      roomType: body.roomType?.trim() || null,
      mealType: body.mealType?.trim() || null,
    },
  })
  await logHotel(handler, booking, `Updated hotel ${acc.hotel} (${acc.city})`)
  return buildApiSuccess(acc, 'Hotel updated')
}

// DELETE — remove a hotel (?accId=)
export async function DELETE(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)
  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const accId = req.nextUrl.searchParams.get('accId')
  if (!accId) return buildApiError('accId is required')
  const existing = await prisma.accommodation.findFirst({ where: { id: accId, bookingId: booking.id } })
  if (!existing) return buildApiError('Hotel not found on this booking', 404)

  await prisma.accommodation.delete({ where: { id: accId } })
  await logHotel(handler, booking, `Removed hotel ${existing.hotel}`)
  return buildApiSuccess(null, 'Hotel removed')
}
