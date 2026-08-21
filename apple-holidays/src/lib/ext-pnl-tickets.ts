/**
 * Shared logic for creating / re-syncing booking tickets from external PNL
 * line items. Used by:
 *   - POST /api/bookings/[ref]/ext-pnl/create-tickets   (explicit button)
 *   - the auto-move-to-latest path in GET /ext-pnl       (amendment landed)
 *
 * Tickets are tagged in their `notes` with "PNL Item #<id>" so re-runs are
 * idempotent. PURCHASED / PAID tickets are never modified — only DRAFT
 * tickets are updated on resync.
 */
import { prisma } from './prisma'
import { clearNoTicketsMark } from '@/lib/no-tickets-clear'

export const PNL_ITEM_NOTE_PREFIX = 'PNL Item #'

export type PnlItemLike = Record<string, string | null | number>

function pnlItemTag(itemId: number): string {
  return `${PNL_ITEM_NOTE_PREFIX}${itemId}`
}

function mapCategory(item: Record<string, string | null>): string {
  const t = (item.type ?? '').toLowerCase()
  if (t.includes('hotel') || item.hotel_name) return 'HOTEL'
  if (t.includes('transport') || item.transport_name) return 'TRANSPORT'
  if (t.includes('attraction') || t.includes('ticket') || t.includes('cruise')) return 'TICKETS'
  if (t.includes('invoice')) return 'OTHER'
  if (t.includes('flight')) return 'FLIGHT_TICKETS'
  return 'OTHER'
}

function buildNoteParts(item: PnlItemLike, tag: string): string {
  return [
    item.item_details,
    item.check_in_date  ? `Check-in: ${item.check_in_date}`  : null,
    item.check_out_date ? `Check-out: ${item.check_out_date}` : null,
    item.client_name    ? `Client: ${item.client_name}`      : null,
    tag,
  ].filter(Boolean).join(' · ')
}

export interface SyncResult { created: number; updated: number; skipped: number }

/**
 * Create tickets for PNL items that have none; when `resync` is true, also
 * refresh existing DRAFT tickets from the latest PNL data.
 */
export async function syncTicketsFromPnl(
  bookingId: string,
  items: PnlItemLike[],
  opts: { resync?: boolean } = {},
): Promise<SyncResult> {
  const resync = opts.resync ?? false
  if (!items || items.length === 0) return { created: 0, updated: 0, skipped: 0 }

  const existingTickets = await prisma.ticket.findMany({
    where: { bookingId },
    select: { id: true, status: true, notes: true },
  })

  // Map "PNL Item #N" → existing ticket
  const tagToTicket = new Map<string, { id: string; status: string }>()
  for (const t of existingTickets) {
    for (const part of (t.notes ?? '').split(' · ')) {
      if (part.startsWith(PNL_ITEM_NOTE_PREFIX)) {
        tagToTicket.set(part, { id: t.id, status: t.status })
      }
    }
  }

  let created = 0, updated = 0, skipped = 0

  for (const item of items) {
    const tag         = pnlItemTag(Number(item.id))
    const existing    = tagToTicket.get(tag)
    const serviceName = (item.hotel_name ?? item.transport_name ?? item.service_name ?? item.type ?? 'PNL Item') as string
    const category    = mapCategory(item as Record<string, string | null>)
    const totalCost   = item.amount_converted != null ? Number(item.amount_converted)
                      : item.amount_original  != null ? Number(item.amount_original)
                      : null
    const currency    = (item.currency as string) || 'USD'
    const supplier    = (item.agent_name as string) || null
    const notes       = buildNoteParts(item, tag)

    if (!existing) {
      await prisma.ticket.create({
        data: { bookingId, type: serviceName, category, qty: 1, supplier, totalCost, currency, notes, status: 'DRAFT' },
      })
      created++
    } else if (resync && existing.status === 'DRAFT') {
      await prisma.ticket.update({
        where: { id: existing.id },
        data: { type: serviceName, category, supplier, totalCost, currency, notes },
      })
      updated++
    } else {
      skipped++
    }
  }

  if (created > 0) await clearNoTicketsMark(bookingId)

  return { created, updated, skipped }
}
