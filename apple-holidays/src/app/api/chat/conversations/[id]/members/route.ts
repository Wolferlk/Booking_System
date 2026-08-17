import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { addMembers, listConversations, removeMember, ChatInvalid, type Identity } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const members: Identity[] = (body.members ?? [])
    .filter((m: { system?: string; user_ref?: string }) => m?.system && m?.user_ref)
    .map((m: { system: string; user_ref: string }) => ({ system: m.system, ref: String(m.user_ref) }))

  return guard(async () => {
    if (!members.length) throw new ChatInvalid('Nobody to add.')
    await addMembers(Number(id), me, members)
    return { conversations: await listConversations(me) }
  })
}

/** Also how someone leaves a group: remove yourself. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  return guard(async () => {
    if (!body.system || !body.user_ref) throw new ChatInvalid('Who should be removed?')
    await removeMember(Number(id), me, { system: String(body.system), ref: String(body.user_ref) })
    return { conversations: await listConversations(me) }
  })
}
