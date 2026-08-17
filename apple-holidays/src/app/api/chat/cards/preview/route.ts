import type { NextRequest } from 'next/server'
import { currentIdentity, unauthorized } from '@/lib/chat/session'
import { preview } from '@/lib/chat/cards'
import type { CardType } from '@/lib/chat/config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const q = req.nextUrl.searchParams
  const snapshot = await preview(q.get('type') as CardType, q.get('ref') ?? '')

  return snapshot
    ? Response.json({ preview: snapshot })
    : Response.json({ message: 'Nothing found for that reference.' }, { status: 404 })
}
