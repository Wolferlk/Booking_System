/**
 * Search for the WhatsApp inbox — web (/dashboard/whatsapp) and the mobile app
 * (through the /api/mobile/web bridge) both call it via the conversations and
 * lookup routes.
 *
 * Staff know a guest by the file, not the phone: "VN12345", the booking ref,
 * the lead guest's name. So a query is matched against bookings first, and a
 * conversation matches when its number belongs to (or its messages are filed
 * under) one of those bookings — plus the usual name / number / message text.
 *
 * File numbers are compared "compacted" (lower-case, letters and digits only),
 * so "VN 12345", "vn-12345" and "VN12345" are the same search.
 */
import { prisma } from '@/lib/prisma'
import type { BookingStatus, OperationCountry, Prisma } from '@prisma/client'

export type SearchField = 'isNumber' | 'bookingRef' | 'cntl' | 'guest' | 'deal' | 'name' | 'phone' | 'message'

export interface SearchMatch {
  field: SearchField
  /** The value that matched — shown (highlighted) under the chat in the list. */
  text: string
}

export interface BookingHit {
  bookingRef: string
  isNumber: string | null
  leadName: string | null
  status: BookingStatus
  operationCountry: OperationCountry | null
  match: SearchMatch
  /** Every number on the file, as stored (may carry a leading +). */
  numbers: { label: string; raw: string }[]
}

export const compactRef = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
export const digitsOf = (s: string) => s.replace(/\D/g, '')
/** Inbox phone key: digits only, no leading +. */
export const phoneKey = (raw: string) => digitsOf(raw)

/** Does the query look like a phone number rather than a name or file number? */
export function looksLikePhone(q: string) {
  const d = digitsOf(q)
  return d.length >= 3 && /^[\d\s+()-]+$/.test(q.trim())
}

const NUMBER_FIELDS = [
  ['contactWhatsapp', 'Guest WhatsApp'],
  ['contactPhone',    'Guest phone'],
  ['agentWhatsapp',   'Agent WhatsApp'],
  ['agentPhone',      'Agent phone'],
] as const

/** Which booking field the query hit, strongest first. */
function classify(
  b: { bookingRef: string; isNumber: string | null; cntlNumber: string | null; dealName: string | null; passengers: { name: string; isLead: boolean }[] },
  q: string,
): SearchMatch | null {
  const lower = q.toLowerCase()
  const compact = compactRef(q)
  if (compact && b.isNumber && compactRef(b.isNumber).includes(compact)) return { field: 'isNumber', text: b.isNumber }
  if (compact && compactRef(b.bookingRef).includes(compact)) return { field: 'bookingRef', text: b.bookingRef }
  if (compact && b.cntlNumber && compactRef(b.cntlNumber).includes(compact)) return { field: 'cntl', text: b.cntlNumber }
  const guest = [...b.passengers].sort((x, y) => Number(y.isLead) - Number(x.isLead)).find(p => p.name.toLowerCase().includes(lower))
  if (guest) return { field: 'guest', text: guest.name }
  if (b.dealName?.toLowerCase().includes(lower)) return { field: 'deal', text: b.dealName }
  return null
}

/**
 * Bookings the query points at, newest first. A country-confined desk only
 * ever gets its own country's files back.
 */
export async function findBookingsForSearch(q: string, country: OperationCountry | null, take = 1000): Promise<BookingHit[]> {
  const query = q.trim()
  if (query.length < 2 || looksLikePhone(query)) return []

  const compact = compactRef(query)
  const digits = digitsOf(query)
  // "VN12345" also tries "12345", so a file number stored as "VN 12345" is
  // still found; classify() then confirms the whole thing really matches.
  const terms = Array.from(new Set([query, compact, digits.length >= 4 ? digits : ''].filter(t => t.length >= 2)))

  const or: Prisma.BookingWhereInput[] = terms.flatMap(t => [
    { isNumber:   { contains: t } },
    { bookingRef: { contains: t } },
    { cntlNumber: { contains: t } },
  ])
  if (query.length >= 3) {
    or.push({ dealName: { contains: query } }, { passengers: { some: { name: { contains: query } } } })
  }

  const rows = await prisma.booking.findMany({
    where:   { AND: [{ OR: or }, country ? { operationCountry: country } : {}] },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      bookingRef: true, isNumber: true, cntlNumber: true, dealName: true, status: true, operationCountry: true,
      contactWhatsapp: true, contactPhone: true, agentWhatsapp: true, agentPhone: true,
      passengers: { select: { name: true, isLead: true }, take: 30 },
    },
  })

  return rows.flatMap(b => {
    const match = classify(b, query)
    if (!match) return []
    const numbers = NUMBER_FIELDS
      .map(([key, label]) => ({ label, raw: b[key] ?? '' }))
      .filter(n => digitsOf(n.raw).length >= 7)
    return [{
      bookingRef:       b.bookingRef,
      isNumber:         b.isNumber,
      leadName:         b.passengers.find(p => p.isLead)?.name ?? null,
      status:           b.status,
      operationCountry: b.operationCountry,
      match,
      numbers,
    }]
  })
}

/** ~70 chars of a message body centred on the hit, for the list preview. */
export function messageExcerpt(body: string, q: string) {
  const flat = body.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0 || flat.length <= 70) return flat
  const start = Math.max(0, at - 24)
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + 70)}${start + 70 < flat.length ? '…' : ''}`
}

/** Search-field priority when one chat matches several ways. */
export const FIELD_RANK: Record<SearchField, number> = {
  isNumber: 0, bookingRef: 1, cntl: 2, phone: 3, name: 4, guest: 5, deal: 6, message: 7,
}
