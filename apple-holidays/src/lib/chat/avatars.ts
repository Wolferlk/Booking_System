/**
 * One face, two systems — the OPS half.
 *
 * Profile photos live in the bucket both applications already share, under
 * `avatars/`, and each app streams them from its own authenticated route. That
 * is what lets an Accounts colleague's photo appear in an OPS chat bubble: the
 * browser never touches the Accounts host, and nothing depends on that host
 * having its `public/storage` symlink in place.
 *
 * Deliberately separate from src/lib/storage.ts and from ./storage.ts: an
 * avatar is neither a permanent operational upload nor chat media, and above
 * all it must never be caught by the 10-day chat sweep.
 *
 * The Accounts counterpart is App\Services\Chat\ChatAvatarService and resolves
 * the same candidate list.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import { CHAT_BUCKET, CHAT_REGION } from './config'

/** MUST match config/chat.php → avatar_prefix. */
export const AVATAR_PREFIX = (process.env.CHAT_AVATAR_PREFIX || 'avatars').replace(/^\/+|\/+$/g, '')

export const AVATAR_MAX_MB = 4
export const AVATAR_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const

let client: S3Client | null = null
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: CHAT_REGION,
      // Dotted bucket name ("ops.aahaas") breaks virtual-host TLS.
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })
  }
  return client
}

export function avatarMime(key: string): string {
  switch ((key.split('.').pop() ?? '').toLowerCase()) {
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'image/jpeg'
  }
}

/**
 * Every object key a stored value could mean, most likely first.
 *
 * The two systems wrote their photos in three different spellings over time and
 * all three are still in live rows, so a read resolves them rather than a
 * migration rewriting them:
 *
 *   avatars/<uuid>.jpg          written by either app since the shared store
 *   /api/uploads/photos/x.jpg   an OPS route → object `uploads/photos/x.jpg`
 *   <name>.jpg                  a bare file name, which means an avatar
 */
export function avatarKeys(raw: string): string[] {
  const clean = raw.trim().replace(/^\/+/, '')
  if (!clean) return []

  const keys = [clean]
  if (clean.startsWith('api/uploads/')) keys.push(clean.slice('api/'.length))
  if (!clean.includes('/')) keys.push(`${AVATAR_PREFIX}/${clean}`)

  return Array.from(new Set(keys))
}

/** The bytes of one photo, or null when nothing in the bucket matches. */
export async function readAvatar(raw: string): Promise<{ bytes: Buffer; mime: string } | null> {
  for (const key of avatarKeys(raw)) {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: CHAT_BUCKET, Key: key }))
      const chunks: Buffer[] = []
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      if (bytes.length) return { bytes, mime: res.ContentType || avatarMime(key) }
    } catch (err) {
      const code = (err as { name?: string; Code?: string })?.name ?? (err as { Code?: string })?.Code
      if (code !== 'NoSuchKey' && code !== 'NotFound') {
        console.error('[chat/avatars] read failed', key, err)
      }
    }
  }
  return null
}

/**
 * Store one photo and return the value to save on the user row.
 *
 * Same key shape the Accounts app writes, in the same bucket, so neither side
 * has to know which system took the picture.
 */
export async function putAvatar(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const kind = (AVATAR_EXTENSIONS as readonly string[]).includes(ext)
    ? ext
    : file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
    : file.type === 'image/jpeg' ? 'jpg'
    : ''

  if (!kind) throw new Error('A profile photo must be a JPG, PNG or WebP image.')
  if (file.size > AVATAR_MAX_MB * 1024 * 1024) {
    throw new Error(`That photo is larger than the ${AVATAR_MAX_MB} MB limit.`)
  }

  const key = `${AVATAR_PREFIX}/${randomUUID()}.${kind}`

  await s3().send(new PutObjectCommand({
    Bucket: CHAT_BUCKET,
    Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: avatarMime(key),
  }))

  return key
}

/**
 * Drop a replaced photo. Best effort on purpose — a photo left in the bucket is
 * an untidy object, while a failed delete that aborted the save would lose the
 * user's new picture.
 */
export async function deleteAvatar(raw: string | null | undefined): Promise<void> {
  if (!raw) return
  for (const key of avatarKeys(raw)) {
    try {
      await s3().send(new DeleteObjectCommand({ Bucket: CHAT_BUCKET, Key: key }))
    } catch {
      /* already gone, or never ours to delete */
    }
  }
}
