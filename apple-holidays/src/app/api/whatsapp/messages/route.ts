/**
 * Global WhatsApp inbox — full thread for one phone number, across every
 * bookingRef it's ever been filed under (including the "UNKNOWN:{phone}"
 * fallback the webhook uses for numbers that didn't match a booking yet).
 * Also resolves the current matching booking, if any, for the linked-booking
 * card, and marks the thread's inbound messages as read.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { findBookingByPhone, normalisePhone, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const phone = normalisePhone(req.nextUrl.searchParams.get('phone') ?? '')
  if (!phone) return buildApiError('phone is required')

  const messages = await prisma.whatsAppMessage.findMany({
    where:   { phone },
    orderBy: { createdAt: 'asc' },
  })

  await prisma.whatsAppMessage.updateMany({
    where: { phone, direction: 'inbound', read: false },
    data:  { read: true },
  })

  const bookingRow = await findBookingByPhone(phone)
  let booking = null
  if (bookingRow) {
    const lead = await prisma.passenger.findFirst({
      where: { bookingId: bookingRow.id, isLead: true },
    })
    booking = {
      bookingRef:       bookingRow.bookingRef,
      leadName:         lead?.name ?? null,
      status:           bookingRow.status,
      operationCountry: bookingRow.operationCountry,
      arrivalDate:      bookingRow.arrivalDate,
      departureDate:    bookingRow.departureDate,
    }
  }

  return buildApiSuccess({ messages, booking })
}
