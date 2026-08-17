import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { markRead } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  return guard(async () => ({
    last_read_id: await markRead(Number(id), me, body.up_to ? Number(body.up_to) : null),
  }))
}
