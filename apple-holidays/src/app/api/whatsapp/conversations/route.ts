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
import { WHATSAPP_STAFF_ROLES, whatsappInboxCountry } from '@/lib/whatsapp'
import { syncInboundRecent } from '@/lib/whatsapp-shared-inbox-sync'
import {
  FIELD_RANK, digitsOf, findBookingsForSearch, looksLikePhone, messageExcerpt, phoneKey,
  type SearchMatch,
} from '@/lib/whatsapp-inbox-search'
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

  const rawSearch = req.nextUrl.searchParams.get('search')?.trim() ?? ''
  const search = rawSearch.toLowerCase()
  // A country-confined desk (Vietnam ground) sees only chats linked to one of
  // its own bookings — never another country's guests or unlinked numbers.
  const scopeCountry = whatsappInboxCountry(session.user.role)

  // Import any replies n8n's webhook stored for numbers we know, so incoming
  // messages surface in this list without anyone opening the thread first.
  await syncInboundRecent()

  // Bounded scan, newest first — this is a support inbox, not a bulk-messaging
  // log, so a few thousand recent rows comfortably covers "every conversation".
  const rows = await prisma.whatsAppMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5000,
    select: {
      phone: true, bookingRef: true, direction: true, body: true, mediaType: true,
      senderName: true, read: true, status: true, createdAt: true,
    },
  })

  type Row = (typeof rows)[number]
  const byPhone = new Map<string, {
    last: Row; unread: number; displayName: string | null; ref: string | null
    refs: Set<string>; bodyHit: string | null
  }>()
  // Message text is only searched for 3+ characters — "VN" would hit half the inbox.
  const bodyNeedle = search.length >= 3 && !looksLikePhone(rawSearch) ? search : ''

  for (const row of rows) {
    let entry = byPhone.get(row.phone)
    if (!entry) {
      entry = { last: row, unread: 0, displayName: null, ref: null, refs: new Set(), bodyHit: null }
      byPhone.set(row.phone, entry)
    }
    if (row.bookingRef) entry.refs.add(row.bookingRef)
    if (bodyNeedle && !entry.bodyHit && row.body?.toLowerCase().includes(bodyNeedle)) {
      entry.bodyHit = messageExcerpt(row.body, rawSearch) // newest matching message
    }
    // Newest-first scan: keep the most recent real bookingRef this number's
    // messages were filed under, as a fallback for numbers that don't match any
    // booking's stored contact (a second line staff messaged the booking from).
    if (!entry.ref && row.bookingRef && !row.bookingRef.startsWith('UNKNOWN:')) entry.ref = row.bookingRef
    if (row.direction === 'inbound' && !row.read) entry.unread += 1
    if (!entry.displayName && row.direction === 'inbound' && row.senderName) entry.displayName = row.senderName
  }

  // Search: which chats match, and why. A file number / ref / guest name hits
  // the bookings, then every number on those files and every chat filed under
  // them comes along.
  const matchByPhone = new Map<string, SearchMatch>()
  if (search) {
    const hits = await findBookingsForSearch(rawSearch, scopeCountry)
    const hitByNumber = new Map<string, SearchMatch>()
    const hitByRef = new Map<string, SearchMatch>()
    for (const h of hits) {
      if (!hitByRef.has(h.bookingRef)) hitByRef.set(h.bookingRef, h.match)
      for (const n of h.numbers) if (!hitByNumber.has(phoneKey(n.raw))) hitByNumber.set(phoneKey(n.raw), h.match)
    }
    const qDigits = looksLikePhone(rawSearch) ? digitsOf(rawSearch) : ''

    for (const [phone, entry] of Array.from(byPhone)) {
      const found: SearchMatch[] = []
      const viaNumber = hitByNumber.get(phone)
      if (viaNumber) found.push(viaNumber)
      for (const ref of Array.from(entry.refs)) {
        const viaRef = hitByRef.get(ref)
        if (viaRef) { found.push(viaRef); break }
      }
      if (qDigits && phone.includes(qDigits)) found.push({ field: 'phone', text: `+${phone}` })
      else if (phone.includes(search)) found.push({ field: 'phone', text: `+${phone}` })
      if (entry.displayName?.toLowerCase().includes(search)) found.push({ field: 'name', text: entry.displayName })
      if (entry.bodyHit) found.push({ field: 'message', text: entry.bodyHit })
      if (found.length) matchByPhone.set(phone, found.sort((a, b) => FIELD_RANK[a.field] - FIELD_RANK[b.field])[0])
    }
  }

  const conversations = Array.from(byPhone.entries())
    .filter(([phone]) => !search || matchByPhone.has(phone))
    .sort((a, b) => new Date(b[1].last.createdAt).getTime() - new Date(a[1].last.createdAt).getTime())

  // One batched lookup for the bookingRef fallbacks above.
  const fallbackRefs = Array.from(new Set(conversations.map(([, e]) => e.ref).filter((r): r is string => !!r)))
  const fallbackBookings = fallbackRefs.length
    ? await prisma.booking.findMany({
        where:  { bookingRef: { in: fallbackRefs } },
        select: { id: true, bookingRef: true, isNumber: true, status: true, operationCountry: true },
      })
    : []
  const bookingByRef = new Map(fallbackBookings.map(b => [b.bookingRef, b]))

  // Same match as findBookingByPhone (any of the four contact columns, as
  // stored or with a leading +, newest booking wins) but in one query for the
  // whole list instead of one per conversation — the inbox polls this every
  // few seconds, so N lookups per poll was the slow part.
  const phones = conversations.map(([phone]) => phone)
  const variants = phones.flatMap(p => [p, `+${p}`])
  const phoneBookings = variants.length
    ? await prisma.booking.findMany({
        where: {
          OR: [
            { contactWhatsapp: { in: variants } },
            { contactPhone:    { in: variants } },
            { agentWhatsapp:   { in: variants } },
            { agentPhone:      { in: variants } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, bookingRef: true, isNumber: true, status: true, operationCountry: true,
          contactWhatsapp: true, contactPhone: true, agentWhatsapp: true, agentPhone: true,
        },
      })
    : []
  const bookingByPhone = new Map<string, (typeof phoneBookings)[number]>()
  for (const b of phoneBookings) {
    for (const raw of [b.contactWhatsapp, b.contactPhone, b.agentWhatsapp, b.agentPhone]) {
      if (!raw) continue
      const key = raw.startsWith('+') ? raw.slice(1) : raw
      if (!bookingByPhone.has(key)) bookingByPhone.set(key, b) // newest first
    }
  }

  const resolved = conversations.map(([phone, entry]) => ({
    phone, entry,
    booking: bookingByPhone.get(phone) ?? (entry.ref ? bookingByRef.get(entry.ref) ?? null : null),
  }))

  // Lead guest per linked booking, so the list can say whose chat it is.
  const bookingIds = Array.from(new Set(resolved.map(r => r.booking?.id).filter((id): id is string => !!id)))
  const leads = bookingIds.length
    ? await prisma.passenger.findMany({ where: { bookingId: { in: bookingIds }, isLead: true }, select: { bookingId: true, name: true } })
    : []
  const leadByBooking = new Map(leads.map(l => [l.bookingId, l.name]))

  const results = resolved.flatMap(({ phone, entry, booking }) => {
    if (scopeCountry && booking?.operationCountry !== scopeCountry) return []
    const { last } = entry
    return [{
      phone,
      displayName: entry.displayName,
      snippet: last.body ?? (last.mediaType ? MEDIA_LABEL[last.mediaType] ?? '📎 Attachment' : ''),
      direction: last.direction,
      status: last.status,
      updatedAt: last.createdAt,
      unreadCount: entry.unread,
      booking: booking ? {
        bookingRef:       booking.bookingRef,
        isNumber:         booking.isNumber,
        leadName:         leadByBooking.get(booking.id) ?? null,
        status:           booking.status,
        operationCountry: booking.operationCountry,
      } : null,
      // Why this chat is in the results — only present while searching.
      ...(search ? { match: matchByPhone.get(phone) ?? null } : {}),
    }]
  })

  return buildApiSuccess(results)
}
