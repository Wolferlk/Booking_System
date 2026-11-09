import { NextRequest } from 'next/server'
import { deskRoute } from '@/lib/ticket-portal/route'
import { deskState } from '@/lib/ticket-portal/desk'

export const dynamic = 'force-dynamic'

/** The desk for one ticket: can it be used, and its portal bookings. Local DB only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return deskRoute('ticket:read', async user => ({ data: await deskState(params.id, user) }))
}
