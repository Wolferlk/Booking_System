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
import { findBookingByPhone, normalisePhone, isWithin24hWindow, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import { syncInboundForPhone } from '@/lib/whatsapp-shared-inbox-sync'
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

  // Pull any replies n8n's webhook stored that we haven't imported yet — this
  // is what makes customer replies appear in the thread (n8n owns the Meta
  // webhook; we read its shared table directly).
  await syncInboundForPhone(phone)

  const messages = await prisma.whatsAppMessage.findMany({
    where:   { phone },
    orderBy: { createdAt: 'asc' },
  })

  await prisma.whatsAppMessage.updateMany({
    where: { phone, direction: 'inbound', read: false },
    data:  { read: true },
  })

  const windowOpen = await isWithin24hWindow(phone)

  // Which booking(s) is this number's history filed under? Staff often message a
  // booking from a second number (an agent's line, a number typed by hand in the
  // booking panel), so the guest-contact lookup alone can miss the thread that
  // actually carries the replies — and the booking-scoped mini chat, which keys
  // on bookingRef, then shows messages this phone-keyed view never had.
  const refs = Array.from(new Set(
    messages.map(m => m.bookingRef).filter(ref => ref && !ref.startsWith('UNKNOWN:')),
  ))

  // Resolve by phone first (live, authoritative); fall back to whatever ref this
  // thread's own messages were filed under, so a second number still shows the
  // linked-booking card instead of nothing.
  const bookingRow =
    (await findBookingByPhone(phone)) ??
    (refs.length ? await prisma.booking.findUnique({ where: { bookingRef: refs[0] } }) : null)

  // Sibling threads: other numbers carrying messages for the same booking(s).
  let relatedThreads: {
    phone: string
    bookingRef: string
    displayName: string | null
    messageCount: number
    lastAt: Date
  }[] = []
  if (refs.length) {
    const siblings = await prisma.whatsAppMessage.findMany({
      where:   { bookingRef: { in: refs }, phone: { not: phone } },
      orderBy: { createdAt: 'asc' },
      select:  { phone: true, bookingRef: true, senderName: true, direction: true, createdAt: true },
    })
    const grouped = new Map<string, (typeof relatedThreads)[number]>()
    for (const row of siblings) {
      const entry = grouped.get(row.phone)
      if (!entry) {
        grouped.set(row.phone, {
          phone:        row.phone,
          bookingRef:   row.bookingRef,
          displayName:  row.direction === 'inbound' ? row.senderName : null,
          messageCount: 1,
          lastAt:       row.createdAt,
        })
        continue
      }
      entry.messageCount += 1
      entry.lastAt = row.createdAt
      if (!entry.displayName && row.direction === 'inbound' && row.senderName) entry.displayName = row.senderName
    }
    relatedThreads = Array.from(grouped.values()).sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
  }

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

  return buildApiSuccess({ messages, booking, windowOpen, relatedThreads })
}
