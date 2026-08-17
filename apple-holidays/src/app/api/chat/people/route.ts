/**
 * The people picker: everyone in BOTH systems, read live from chat_directory.
 * No user is copied for chat — see lib/chat/directory.ts.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { listPeople } from '@/lib/chat/directory'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { searchParams } = req.nextUrl
  return guard(async () => ({
    people: await listPeople({
      search: searchParams.get('q'),
      system: searchParams.get('system'),
      exclude: [me.system, me.ref],
    }),
  }))
}
