import { NextRequest } from 'next/server'
import { deskRoute } from '@/lib/ticket-portal/route'
import { DeskError } from '@/lib/ticket-portal/desk'
import { approveCart, matchGroup, payCartLine, scan, sendCartCode } from '@/lib/ticket-portal/bulk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Bulk Issue Desk (src/lib/ticket-portal/bulk.ts).
 *   GET  scan       — open tickets in a date window, grouped by product. Reads only.
 *   POST match      — one group on GlobalTix / Cebu, priced per ticket. Reads only.
 *   POST send-code  — one WhatsApp code for the whole held cart.
 *   POST approve    — check that code; approves exactly that cart for a short while.
 *   POST pay        — pay one line of an approved cart.
 * Holding goes through the single-ticket route (/api/tickets/[id]/portal/hold).
 */
export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
  const url = req.nextUrl.searchParams
  return deskRoute('ticket:purchase', async user => {
    if (params.action !== 'scan') throw new DeskError('Unknown step.', 404)
    return {
      data: await scan(user, {
        from: url.get('from') ?? '', to: url.get('to') ?? '', q: url.get('q'), country: url.get('country'), includeAll: url.get('all') === '1',
      }),
    }
  })
}

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const body = (await req.json().catch(() => ({}))) as {
    ticketIds?: string[]; q?: string; fresh?: boolean; items?: unknown; code?: string; ticketId?: string; bookingId?: string
  }
  return deskRoute('ticket:purchase', async user => {
    switch (params.action) {
      case 'match':
        return { data: await matchGroup(user, { ticketIds: body.ticketIds ?? [], q: body.q, fresh: body.fresh === true }) }
      case 'send-code':
        return { data: await sendCartCode(body.items, user) }
      case 'approve':
        return { data: await approveCart(body.items, body.code ?? '', user), message: 'Cart approved.' }
      case 'pay':
        return { data: await payCartLine(body.items, { ticketId: body.ticketId ?? '', bookingId: body.bookingId ?? '' }, user), message: 'Ticket issued.' }
      default:
        throw new DeskError('Unknown step.', 404)
    }
  })
}
