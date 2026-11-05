/**
 * Booking lookup for the WhatsApp inbox search — "VN12345" finds the file even
 * when nobody has messaged its guest yet, and lists every number on it with
 * whether a chat already exists, so the desk can open or start one in a tap.
 * Used by the web inbox and the mobile app (via the /api/mobile/web bridge).
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { WHATSAPP_STAFF_ROLES, whatsappInboxCountry } from '@/lib/whatsapp'
import { findBookingsForSearch, phoneKey } from '@/lib/whatsapp-inbox-search'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const LIMIT = 6

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const hits = (await findBookingsForSearch(q, whatsappInboxCountry(session.user.role), 40))
    .filter(h => h.numbers.length > 0)
    .slice(0, LIMIT)
  if (!hits.length) return buildApiSuccess([])

  const keys = Array.from(new Set(hits.flatMap(h => h.numbers.map(n => phoneKey(n.raw)))))
  const existing = await prisma.whatsAppMessage.groupBy({
    by:    ['phone'],
    where: { phone: { in: keys } },
    _max:  { createdAt: true },
  })
  const lastAt = new Map(existing.map(e => [e.phone, e._max.createdAt]))

  return buildApiSuccess(hits.map(h => {
    // One row per distinct number — guest WhatsApp and guest phone are often the same.
    const seen = new Set<string>()
    const numbers = h.numbers.flatMap(n => {
      const phone = phoneKey(n.raw)
      if (seen.has(phone)) return []
      seen.add(phone)
      return [{ phone, label: n.label, hasChat: lastAt.has(phone), lastAt: lastAt.get(phone) ?? null }]
    })
    return {
      bookingRef:       h.bookingRef,
      isNumber:         h.isNumber,
      leadName:         h.leadName,
      status:           h.status,
      operationCountry: h.operationCountry,
      match:            h.match,
      numbers,
    }
  }))
}
