/**
 * The presence keepalive.
 *
 * `chat_presence` still exists because the directory's "online" dot is resolved
 * in SQL alongside every person lookup, in both apps. What changed is the rate:
 * the poll wrote a row per user per tick (up to 40 writes a minute each) purely
 * to say "still here". On the push path the browser says it every 30 seconds
 * while the tab is visible, and the hub's connect/disconnect events carry the
 * instant part.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { heartbeat } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const body = await req.json().catch(() => ({}))

  return guard(async () => {
    await heartbeat(me, body.typing_in ? Number(body.typing_in) : null)
    return { ok: true }
  })
}
