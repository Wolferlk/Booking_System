import { NextRequest } from 'next/server'
import { deskRoute } from '@/lib/ticket-portal/route'
import { compare } from '@/lib/ticket-portal/desk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** GlobalTix and Cebu side by side for this ticket. Reads only; nothing is held. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const url = req.nextUrl.searchParams
  return deskRoute('ticket:purchase', async user => ({
    data: await compare(params.id, user, { q: url.get('q'), fresh: url.get('fresh') === '1' }),
  }))
}
