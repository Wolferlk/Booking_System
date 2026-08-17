/**
 * Upload now, attach later.
 *
 * Files go up while the caption is still being typed, so pressing send is
 * instant. The rows are created with message_id NULL and adopted by sendMessage.
 * Anything the user abandons stays an orphan and is cleared by the same 10-day
 * sweep as everything else, so an interrupted upload costs nothing.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { assertMember, findAttachment, shapeAttachment, ChatInvalid } from '@/lib/chat/service'
import { putChatFile } from '@/lib/chat/storage'

export const dynamic = 'force-dynamic'
// Uploads are streamed to S3, which the edge runtime cannot do.
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const form = await req.formData()
  const conversationId = Number(form.get('conversation_id'))
  const files = form.getAll('files[]').filter((f): f is File => f instanceof File)
  const durationMs = form.get('duration_ms') ? Number(form.get('duration_ms')) : null
  const waveform = form.getAll('waveform[]').map(Number).filter(Number.isFinite)

  return guard(async () => {
    if (!conversationId) throw new ChatInvalid('No conversation given.')
    if (!files.length) throw new ChatInvalid('No files were received.')
    if (files.length > 12) throw new ChatInvalid('Twelve files at a time is the limit.')

    await assertMember(conversationId, me)

    const attachments = []
    for (const file of files) {
      const id = await putChatFile(file, {
        conversationId,
        durationMs,
        waveform: waveform.length ? waveform : null,
      })
      const row = await findAttachment(id)
      if (row) attachments.push(shapeAttachment(row))
    }

    return { attachments }
  })
}
