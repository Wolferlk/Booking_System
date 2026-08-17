/**
 * Stream one attachment.
 *
 * Two guards, both necessary: the reader has to be a member of the conversation
 * the file was posted in, and the object has to still exist — after ten days it
 * does not, and that is answered as a clean 410 rather than a broken download.
 *
 * Files uploaded from the Accounts system are served here byte for byte out of
 * the shared bucket. There is no copy and no cross-host redirect.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, unauthorized } from '@/lib/chat/session'
import { assertMember, ChatForbidden } from '@/lib/chat/service'
import { attachmentRow, getChatFile, contentTypeFor } from '@/lib/chat/storage'
import { MEDIA_TTL_DAYS } from '@/lib/chat/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { id } = await params
  const row = await attachmentRow(Number(id))
  if (!row) return Response.json({ message: 'Not found.' }, { status: 404 })

  try {
    await assertMember(row.conversation_id, me)
  } catch (err) {
    if (err instanceof ChatForbidden) return Response.json({ message: err.message }, { status: 403 })
    throw err
  }

  const expired = Boolean(row.purged_at) || Boolean(row.expires_at && new Date(row.expires_at) <= new Date())
  if (expired) {
    return Response.json(
      { message: `This file has expired. Chat media is kept for ${MEDIA_TTL_DAYS} days.` },
      { status: 410 },
    )
  }

  const wantsThumb = req.nextUrl.searchParams.get('thumb') === '1'
  const bytes = await getChatFile(wantsThumb && row.thumb_key ? row.thumb_key : row.disk_key)
  if (!bytes) return Response.json({ message: 'File is no longer available.' }, { status: 410 })

  const disposition = req.nextUrl.searchParams.get('download') ? 'attachment' : 'inline'

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': row.mime || contentTypeFor(row.file_name),
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${disposition}; filename="${row.file_name.replace(/"/g, '')}"`,
      // Private: the URL is authenticated, so it must never sit in a shared
      // cache. A short browser cache keeps a scrolled-past image from being
      // re-fetched on every render.
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
