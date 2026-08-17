/**
 * Open (or create) the direct thread with one person — who may be in either
 * system. Deduplicated on the unique dm_key, so two people clicking each other
 * at the same instant still end up in one thread.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { listConversations, openDirect, ChatInvalid } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const system = String(body.system ?? '')
  const userRef = String(body.user_ref ?? '')

  return guard(async () => {
    if (!['accounts', 'ops'].includes(system) || !userRef) {
      throw new ChatInvalid('A system and a user reference are required.')
    }
    const id = await openDirect(me, { system, ref: userRef })
    return { conversation_id: id, conversations: await listConversations(me) }
  })
}
