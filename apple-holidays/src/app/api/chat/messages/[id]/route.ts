import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { deleteMessage, editMessage, ChatInvalid } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  return guard(async () => {
    const text = String(body.body ?? '').trim()
    if (!text) throw new ChatInvalid('A message cannot be edited to nothing — delete it instead.')
    return { message: await editMessage(Number(id), me, text) }
  })
}

/** Soft delete — the bubble becomes a tombstone, the thread keeps its shape. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  return guard(async () => ({ message: await deleteMessage(Number(id), me) }))
}
