import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { suggest } from '@/lib/chat/cards'
import type { CardType } from '@/lib/chat/config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const q = req.nextUrl.searchParams
  return guard(async () => ({
    suggestions: await suggest(q.get('type') as CardType, q.get('q') ?? ''),
  }))
}
