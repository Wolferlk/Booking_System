/**
 * Global WhatsApp inbox — conversation list. Groups every stored message by
 * phone number (independent of whichever bookingRef it happened to be filed
 * under at receipt time) and resolves the current best-match booking live,
 * so numbers that arrived before their booking existed still show up linked.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { findBookingByPhone, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import { syncInboundRecent } from '@/lib/whatsapp-shared-inbox-sync'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const MEDIA_LABEL: Record<string, string> = {
  image:    '📷 Photo',
  document: '📄 Document',
  audio:    '🎤 Voice message',
  video:    '🎥 Video',
  sticker:  '🩶 Sticker',
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const search = req.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? ''

  // Import any replies n8n's webhook stored for numbers we know, so incoming
  // messages surface in this list without anyone opening the thread first.
  await syncInboundRecent()

  // Bounded scan, newest first — this is a support inbox, not a bulk-messaging
  // log, so a few thousand recent rows comfortably covers "every conversation".
  const rows = await prisma.whatsAppMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5000,
  })

  type Row = (typeof rows)[number]
  const byPhone = new Map<string, { last: Row; unread: number; displayName: string | null; ref: string | null }>()

  for (const row of rows) {
    let entry = byPhone.get(row.phone)
    if (!entry) {
      entry = { last: row, unread: 0, displayName: null, ref: null }
      byPhone.set(row.phone, entry)
    }
    // Newest-first scan: keep the most recent real bookingRef this number's
    // messages were filed under, as a fallback for numbers that don't match any
    // booking's stored contact (a second line staff messaged the booking from).
    if (!entry.ref && row.bookingRef && !row.bookingRef.startsWith('UNKNOWN:')) entry.ref = row.bookingRef
    if (row.direction === 'inbound' && !row.read) entry.unread += 1
    if (!entry.displayName && row.direction === 'inbound' && row.senderName) entry.displayName = row.senderName
  }

  const conversations = Array.from(byPhone.entries())
    .filter(([phone, entry]) => {
      if (!search) return true
      const haystack = `${phone} ${entry.displayName ?? ''}`.toLowerCase()
      return haystack.includes(search)
    })
    .sort((a, b) => new Date(b[1].last.createdAt).getTime() - new Date(a[1].last.createdAt).getTime())

  // One batched lookup for the bookingRef fallbacks above.
  const fallbackRefs = Array.from(new Set(conversations.map(([, e]) => e.ref).filter((r): r is string => !!r)))
  const fallbackBookings = fallbackRefs.length
    ? await prisma.booking.findMany({
        where:  { bookingRef: { in: fallbackRefs } },
        select: { bookingRef: true, status: true, operationCountry: true },
      })
    : []
  const bookingByRef = new Map(fallbackBookings.map(b => [b.bookingRef, b]))

  const results = await Promise.all(conversations.map(async ([phone, entry]) => {
    const booking = (await findBookingByPhone(phone)) ?? (entry.ref ? bookingByRef.get(entry.ref) ?? null : null)
    const { last } = entry
    return {
      phone,
      displayName: entry.displayName,
      snippet: last.body ?? (last.mediaType ? MEDIA_LABEL[last.mediaType] ?? '📎 Attachment' : ''),
      direction: last.direction,
      updatedAt: last.createdAt,
      unreadCount: entry.unread,
      booking: booking ? {
        bookingRef:       booking.bookingRef,
        status:           booking.status,
        operationCountry: booking.operationCountry,
      } : null,
    }
  }))

  return buildApiSuccess(results)
}
