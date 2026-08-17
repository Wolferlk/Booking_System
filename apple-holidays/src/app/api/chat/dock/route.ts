/**
 * Persist the mini-chat dock.
 *
 * Stored per user so the same boxes come back on any machine, and so a full
 * page navigation cannot throw a conversation away mid-sentence.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { saveDock } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const dock = (body.dock ?? [])
    .filter((d: { conversation_id?: number }) => Number(d?.conversation_id))
    .map((d: { conversation_id: number; minimized?: boolean }) => ({
      conversation_id: Number(d.conversation_id),
      minimized: Boolean(d.minimized),
    }))

  return guard(async () => { await saveDock(me, dock); return { ok: true } })
}
