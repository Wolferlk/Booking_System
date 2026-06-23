import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const PNL_ITEM_NOTE_PREFIX = 'PNL Item #'

function pnlItemTag(itemId: number) {
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

function buildNoteParts(item: Record<string, string | null | number>, tag: string): string {
  return [
    item.item_details,
    item.check_in_date  ? `Check-in: ${item.check_in_date}`  : null,
    item.check_out_date ? `Check-out: ${item.check_out_date}` : null,
    item.client_name    ? `Client: ${item.client_name}`      : null,
    tag,
  ].filter(Boolean).join(' · ')
}

/**
 * POST /api/bookings/[ref]/ext-pnl/create-tickets
 *
 * ?resync=true  — update existing DRAFT tickets from PNL + create any new ones.
 *                 Never deletes or modifies PURCHASED/PAID tickets.
 * (default)     — create tickets only for PNL items that have no ticket yet.
 *
 * Returns { created, updated, skipped }
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:create')) return buildApiError('Forbidden', 403)

  const resync = req.nextUrl.searchParams.get('resync') === 'true'

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const pnlLink = await prisma.externalPnlLink.findUnique({
    where: { bookingId: booking.id },
  })
  if (!pnlLink) return buildApiError('No Accounts PNL linked to this booking', 404)

  const items = pnlLink.cachedItems as Record<string, string | null | number>[]
  if (!items || items.length === 0) {
    return buildApiSuccess({ created: 0, updated: 0, skipped: 0 }, 'No PNL items found')
  }

  // Load all existing tickets for this booking — we need id, status, notes
  const existingTickets = await prisma.ticket.findMany({
    where: { bookingId: booking.id },
    select: { id: true, status: true, notes: true },
  })

  // Build a map: "PNL Item #N" → existing ticket
  const tagToTicket = new Map<string, { id: string; status: string }>()
  for (const t of existingTickets) {
    for (const part of (t.notes ?? '').split(' · ')) {
      if (part.startsWith(PNL_ITEM_NOTE_PREFIX)) {
        tagToTicket.set(part, { id: t.id, status: t.status })
      }
    }
  }

  let created = 0
  let updated = 0
  let skipped = 0

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
      // No ticket yet — create
      await prisma.ticket.create({
        data: { bookingId: booking.id, type: serviceName, category, qty: 1, supplier, totalCost, currency, notes, status: 'DRAFT' },
      })
      created++
    } else if (resync && existing.status === 'DRAFT') {
      // Re-sync: update draft ticket with latest PNL data
      await prisma.ticket.update({
        where: { id: existing.id },
        data: { type: serviceName, category, supplier, totalCost, currency, notes },
      })
      updated++
    } else {
      skipped++
    }
  }

  const msg = resync
    ? `Re-synced: ${created} created, ${updated} updated, ${skipped} skipped`
    : `${created} ticket${created !== 1 ? 's' : ''} created, ${skipped} already existed`

  return buildApiSuccess({ created, updated, skipped }, msg)
}
