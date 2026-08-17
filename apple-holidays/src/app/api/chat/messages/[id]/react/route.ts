import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { react, ChatInvalid } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  return guard(async () => {
    if (!body.emoji) throw new ChatInvalid('No emoji given.')
    return { message: await react(Number(id), me, String(body.emoji)) }
  })
}
