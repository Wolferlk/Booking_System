/**
 * The message stream.
 *
 * GET is both directions of paging on purpose — `after` is the live tail read
 * the poll uses, `before` walks history for infinite scroll — so both return
 * identically shaped rows.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { listConversations, listMessages, sendMessage, ChatInvalid } from '@/lib/chat/service'
import { preview } from '@/lib/chat/cards'
import { CARDS, type CardType } from '@/lib/chat/config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const q = req.nextUrl.searchParams

  return guard(async () => ({
    messages: await listMessages(Number(id), me, {
      before: q.get('before') ? Number(q.get('before')) : null,
      after: q.get('after') !== null ? Number(q.get('after')) : null,
      limit: q.get('limit') ? Number(q.get('limit')) : undefined,
    }),
  }))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  return guard(async () => {
    // A card message snapshots the record at send time. Refusing an unresolvable
    // reference here is deliberate: a card that opens onto nothing is worse than
    // no card at all.
    let cardPayload: Record<string, unknown> | null = null
    if (body.kind === 'card') {
      const type = body.card_type as CardType
      const snapshot = await preview(type, String(body.card_ref ?? ''))
      if (!snapshot) {
        throw new ChatInvalid(`No ${CARDS[type]?.label ?? 'record'} found for “${body.card_ref}”.`)
      }
      cardPayload = snapshot as unknown as Record<string, unknown>
    }

    const message = await sendMessage(Number(id), me, {
      body: body.body ?? null,
      kind: body.kind ?? 'text',
      client_uuid: body.client_uuid ?? null,
      reply_to_id: body.reply_to_id ? Number(body.reply_to_id) : null,
      attachment_ids: (body.attachment_ids ?? []).map(Number),
      card_type: body.card_type ?? null,
      card_ref: body.card_ref ? String(body.card_ref).toUpperCase() : null,
      card_payload: cardPayload,
    })

    return { message, conversations: await listConversations(me) }
  })
}
