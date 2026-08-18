/**
 * Serve one person's profile photo — an OPS colleague's, or an Accounts one.
 *
 * Addressed by identity rather than by file, so the same URL survives the photo
 * being replaced, works for both systems' people, and never has to reach across
 * to the other application's host.
 *
 * A missing photo answers 404 deliberately: every avatar in the UI falls back
 * to initials, so 404 degrades to initials instead of a broken-image icon.
 *
 * The Accounts counterpart is App\Http\Controllers\AvatarController.
 */
import type { NextRequest } from 'next/server'
import { currentIdentity, unauthorized } from '@/lib/chat/session'
import { rawAvatar } from '@/lib/chat/directory'
import { readAvatar } from '@/lib/chat/avatars'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ system: string; ref: string }> },
) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const { system, ref } = await params
  if (system !== 'accounts' && system !== 'ops') {
    return new Response('Not found', { status: 404 })
  }

  const raw = await rawAvatar(system, decodeURIComponent(ref))
  if (!raw) return new Response('Not found', { status: 404 })

  // A photo hosted somewhere else entirely: hand the browser the address rather
  // than proxying bytes we have no reason to touch.
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return Response.redirect(raw, 302)
  }

  const photo = await readAvatar(raw)
  if (!photo) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      'Content-Type': photo.mime,
      'Content-Length': String(photo.bytes.length),
      // Private: staff photos behind an authenticated route must not sit in a
      // shared cache. The URL carries a digest of the stored path, so a
      // replaced photo is a different URL and the long life is safe.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
