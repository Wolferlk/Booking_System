/**
 * WhatsApp message-count report for the inbox: how many messages went out and
 * came in over a date range, how many were delivered / read / failed, per day,
 * per kind of send (desk reply, daily plan, driver brief…) and per Meta failure.
 *
 * Counts only — bodies are never read, so the range can be wide.
 */
import { prisma } from '@/lib/prisma'
import { whatsappInboxCountry } from '@/lib/whatsapp'
import { failureDetailsFor } from '@/lib/whatsapp-shared-inbox-sync'

/** Longest range one report covers. */
export const REPORT_MAX_DAYS = 93

/**
 * Keep only the rows this role may see. A country-confined desk gets rows filed
 * under one of its own country's bookings — the same rule as the inbox list.
 */
export async function rowsInScope<T extends { bookingRef: string }>(role: string | undefined | null, rows: T[]): Promise<T[]> {
  const country = whatsappInboxCountry(role)
  if (!country) return rows
  const refs = Array.from(new Set(rows.map(r => r.bookingRef).filter(r => r && !r.startsWith('UNKNOWN:'))))
  const allowed = new Set<string>()
  for (let i = 0; i < refs.length; i += 1000) {
    const found = await prisma.booking.findMany({
      where:  { bookingRef: { in: refs.slice(i, i + 1000) }, operationCountry: country },
      select: { bookingRef: true },
    })
    for (const b of found) allowed.add(b.bookingRef)
  }
  return rows.filter(r => allowed.has(r.bookingRef))
}

export interface CountRow {
  sent: number
  delivered: number
  read: number
  failed: number
  retried: number
  pending: number
  received: number
}

export interface MessageReport {
  from: string
  to: string
  totals: CountRow & { chats: number; chatsMessaged: number; chatsReplied: number }
  byDay: (CountRow & { date: string })[]
  byKind: (CountRow & { kind: string })[]
  failures: { code: number | null; reason: string; count: number }[]
}

const empty = (): CountRow => ({ sent: 0, delivered: 0, read: 0, failed: 0, retried: 0, pending: 0, received: 0 })

/** What kind of send a row is, from its sender tag. */
function kindOf(direction: string, senderName: string | null): string {
  if (direction === 'inbound') return 'Replies from guests / drivers'
  const s = (senderName ?? '').trim()
  const tag = /^\[([A-Z0-9-]+)/.exec(s)?.[1]
  if (tag) return tag.replace(/-/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())
  if (/Auto-Send$/.test(s)) return 'QC auto-send'
  return s ? 'Desk replies' : 'System'
}

function add(row: CountRow, direction: string, status: string) {
  if (direction === 'inbound') { row.received += 1; return }
  row.sent += 1
  if (status === 'delivered') row.delivered += 1
  else if (status === 'read') { row.delivered += 1; row.read += 1 }
  else if (status === 'failed') row.failed += 1
  else if (status === 'retried') row.retried += 1
  else if (status !== 'sent') row.pending += 1
}

/**
 * Counts between `from` and `to` (inclusive). `tzOffsetMin` is the viewer's
 * Date#getTimezoneOffset(), so days split at the desk's own midnight.
 */
export async function buildMessageReport(from: Date, to: Date, tzOffsetMin: number, role: string | undefined | null): Promise<MessageReport> {
  const rows = await rowsInScope(role, await prisma.whatsAppMessage.findMany({
    where:  { createdAt: { gte: from, lte: to } },
    select: { phone: true, bookingRef: true, direction: true, status: true, senderName: true, waMessageId: true, createdAt: true },
  }))

  const dayOf = (d: Date) => new Date(d.getTime() - tzOffsetMin * 60000).toISOString().slice(0, 10)
  const totals = empty()
  const byDay = new Map<string, CountRow>()
  const byKind = new Map<string, CountRow>()
  const chats = new Set<string>(), messaged = new Set<string>(), replied = new Set<string>()

  for (const r of rows) {
    const day = dayOf(r.createdAt)
    const kind = kindOf(r.direction, r.senderName)
    if (!byDay.has(day)) byDay.set(day, empty())
    if (!byKind.has(kind)) byKind.set(kind, empty())
    add(totals, r.direction, r.status)
    add(byDay.get(day)!, r.direction, r.status)
    add(byKind.get(kind)!, r.direction, r.status)
    chats.add(r.phone)
    ;(r.direction === 'inbound' ? replied : messaged).add(r.phone)
  }

  // Every day in the range, quiet ones included, so the table reads as a calendar.
  const days: MessageReport['byDay'] = []
  for (let t = from.getTime(); dayOf(new Date(t)) <= dayOf(to); t += 86400000) {
    const date = dayOf(new Date(t))
    if (!days.some(d => d.date === date)) days.push({ date, ...(byDay.get(date) ?? empty()) })
  }

  const failedIds = rows.filter(r => r.status === 'failed' && r.waMessageId).map(r => r.waMessageId!)
  const details = await failureDetailsFor(failedIds)
  const failures = new Map<string, { code: number | null; reason: string; count: number }>()
  for (const r of rows) {
    if (r.direction !== 'outbound' || r.status !== 'failed') continue
    const d = r.waMessageId ? details.get(r.waMessageId) : undefined
    const key = d?.code != null ? String(d.code) : 'unknown'
    const f = failures.get(key) ?? { code: d?.code ?? null, reason: d?.reason ?? 'No reason recorded by WhatsApp', count: 0 }
    f.count += 1
    failures.set(key, f)
  }

  return {
    from: from.toISOString(),
    to:   to.toISOString(),
    totals: { ...totals, chats: chats.size, chatsMessaged: messaged.size, chatsReplied: replied.size },
    byDay: days.reverse(),
    byKind: Array.from(byKind, ([kind, c]) => ({ kind, ...c })).sort((a, b) => (b.sent + b.received) - (a.sent + a.received)),
    failures: Array.from(failures.values()).sort((a, b) => b.count - a.count),
  }
}
