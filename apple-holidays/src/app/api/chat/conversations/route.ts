import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { listConversations } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await currentIdentity()
  if (!me) return unauthorized()
  return guard(async () => ({ conversations: await listConversations(me) }))
}
