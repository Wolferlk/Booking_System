/**
 * The live tick — one cheap request per interval for the whole app.
 * See lib/chat/service.ts → pulse() for why the client can poll this at 1.5s.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { pulse } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const typing = req.nextUrl.searchParams.get('typing_in')
  return guard(() => pulse(me, typing ? Number(typing) : null))
}
