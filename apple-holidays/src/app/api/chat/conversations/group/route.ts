/**
 * Create a group. Members may freely mix Accounts and Operations people — a
 * cross-system group is ordinary, not a special case.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { createGroup, listConversations, type Identity } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const members: Identity[] = (body.members ?? [])
    .filter((m: { system?: string; user_ref?: string }) => m?.system && m?.user_ref)
    .map((m: { system: string; user_ref: string }) => ({ system: m.system, ref: String(m.user_ref) }))

  return guard(async () => {
    const id = await createGroup(me, String(body.title ?? ''), members, body.emoji, body.accent)
    return { conversation_id: id, conversations: await listConversations(me) }
  })
}
