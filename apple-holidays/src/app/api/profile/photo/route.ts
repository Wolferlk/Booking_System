/**
 * My profile photo.
 *
 * Written to the bucket both systems share, so the picture taken here is the
 * picture the Accounts desk sees next to these messages — the chat directory
 * reads `users.avatar` live, and both apps serve it through their own avatar
 * route. Nothing is copied between systems.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { putAvatar, deleteAvatar, AVATAR_MAX_MB } from '@/lib/chat/avatars'

export const dynamic = 'force-dynamic'
// Streams the image to S3, which the edge runtime cannot do.
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return buildApiError('Unauthorized', 401)

  const form = await req.formData().catch(() => null)
  const file = form?.get('photo')

  if (!(file instanceof File) || !file.size) {
    return buildApiError(`No image reached the server. Pick a photo under ${AVATAR_MAX_MB} MB.`, 422)
  }

  let key: string
  try {
    key = await putAvatar(file)
  } catch (err) {
    return buildApiError((err as Error).message || 'The photo could not be saved.', 422)
  }

  const previous = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { avatar: true },
  })

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { avatar: key },
    select: { id: true, name: true, avatar: true },
  })

  // Only after the new photo is safely stored, and never the legacy
  // `/api/uploads/...` form — those objects belong to the uploads store and may
  // be referenced elsewhere.
  if (previous?.avatar && previous.avatar !== key && !previous.avatar.includes('uploads/')) {
    await deleteAvatar(previous.avatar)
  }

  return buildApiSuccess(user)
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return buildApiError('Unauthorized', 401)

  const previous = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { avatar: true },
  })

  await prisma.user.update({ where: { id: session.user.id }, data: { avatar: null } })

  if (previous?.avatar && !previous.avatar.includes('uploads/')) {
    await deleteAvatar(previous.avatar)
  }

  return buildApiSuccess({ avatar: null })
}
