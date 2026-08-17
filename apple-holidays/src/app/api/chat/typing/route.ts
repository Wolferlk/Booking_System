/**
 * "I am typing" — pushed, not stored.
 *
 * On the polling path typing rode along on every pulse and was written to
 * `chat_presence`, so the database took a write per person per tick to carry
 * something that is meaningless three seconds later. Here it is one small POST
 * only while someone is actually typing, and it never touches a table.
 *
 * Membership is checked before publishing: the hub fans out to whoever it is
 * told, so deciding who may be told is this app's job, not the hub's.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { assertMember } from '@/lib/chat/service'
import { publish, recipientsOf, realtimeEnabled } from '@/lib/chat/realtime'
import { findPerson } from '@/lib/chat/directory'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const conversationId = Number(body.conversation_id)

  return guard(async () => {
    if (!realtimeEnabled() || !conversationId) return { ok: false }

    await assertMember(conversationId, me)

    const myKey = `${me.system}:${me.ref}`
    const to = (await recipientsOf(conversationId)).filter(k => k !== myKey)
    const name = (await findPerson(me.system, me.ref))?.name ?? 'Someone'

    await publish({
      to,
      event: 'typing',
      data: {
        conversation_id: conversationId,
        key: myKey,
        name,
        // The receiver forgets it after this long without another one, so a
        // closed tab cannot leave "…is typing" on screen forever.
        lease_ms: 5000,
        stopped: Boolean(body.stopped),
      },
    })

    return { ok: true }
  })
}
