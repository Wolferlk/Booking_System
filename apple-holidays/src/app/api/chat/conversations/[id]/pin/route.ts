import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { setPinned } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  return guard(async () => {
    await setPinned(Number(id), me, Boolean(body.pinned))
    return { ok: true }
  })
}
