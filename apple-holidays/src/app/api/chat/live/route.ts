/**
 * The browser's pass to the realtime hub.
 *
 * The identity is taken from the server session here and signed, so the hub can
 * trust "this stream belongs to ops:<id>" without knowing anything about
 * NextAuth. Tickets are short-lived and the client renews before expiry.
 *
 * `{ url: null }` means the hub is not configured — the client then simply keeps
 * polling, which is why this whole feature can be deployed dark.
 */
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { mintTicket, realtimeEnabled } from '@/lib/chat/realtime'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  return guard(async () => {
    if (!realtimeEnabled()) return { url: null, ticket: null, expires_at: null, renew_in_seconds: 0 }
    return mintTicket(me)
  })
}
