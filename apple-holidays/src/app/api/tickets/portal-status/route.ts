import { NextRequest } from 'next/server'
import { deskRoute } from '@/lib/ticket-portal/route'
import { portalStatus } from '@/lib/ticket-portal/status'

export const dynamic = 'force-dynamic'

/** Is the desk on, and where do these tickets stand on it? `?ids=a,b,c`. Reads only. */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return deskRoute('ticket:read', async user => ({ data: await portalStatus(ids, user) }))
}
