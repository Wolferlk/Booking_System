import { NextRequest } from 'next/server'
import { deskRoute } from '@/lib/ticket-portal/route'
import { hold, type HoldInput } from '@/lib/ticket-portal/desk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Hold on GlobalTix, or create an unpaid order on Cebu. Spends nothing. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as HoldInput
  return deskRoute('ticket:purchase', async user => ({ data: await hold(params.id, body, user), message: 'Held. Nothing has been charged yet.' }))
}
