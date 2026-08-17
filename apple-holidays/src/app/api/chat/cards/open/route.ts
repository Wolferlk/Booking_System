/**
 * Open a card — a fresh read, on every click.
 *
 * Never the snapshot stored on the message: an invoice popup showing last
 * month's balance because that is what the bubble happened to capture would be
 * worse than no popup.
 *
 * Membership of the conversation is checked first. A card is a document link,
 * and a link must not become a way around the permissions on the thread it was
 * posted in.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { assertMember } from '@/lib/chat/service'
import { buildDocument } from '@/lib/chat/cards'
import type { CardType } from '@/lib/chat/config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const q = req.nextUrl.searchParams
  const conversationId = q.get('conversation_id')

  return guard(async () => {
    if (conversationId) await assertMember(Number(conversationId), me)
    return { document: await buildDocument(q.get('type') as CardType, q.get('ref') ?? '') }
  })
}
