/**
 * Everything the client needs on first paint, in one request.
 *
 * Mirrors ChatApiController::bootstrap() in the Accounts app — same keys, same
 * shape — so the two front ends stay recognisably the same product.
 */
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { listConversations, getSettings } from '@/lib/chat/service'
import { findPerson, unknownPerson } from '@/lib/chat/directory'
import { CARDS, MAX_UPLOAD_MB, MEDIA_TTL_DAYS, PAGE_SIZE, POLL, SYSTEMS } from '@/lib/chat/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  return guard(async () => ({
    me: (await findPerson(me.system, me.ref)) ?? unknownPerson(me.system, me.ref),
    conversations: await listConversations(me),
    settings: await getSettings(me),
    config: {
      poll: POLL,
      systems: SYSTEMS,
      cards: CARDS,
      media_ttl_days: MEDIA_TTL_DAYS,
      max_upload_mb: MAX_UPLOAD_MB,
      page_size: PAGE_SIZE,
    },
  }))
}
