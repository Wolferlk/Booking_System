/**
 * Chat media in the bucket both systems share.
 *
 * Keys are `<prefix>/YYYY/MM/<uuid>.<ext>`, identical on both sides, so a voice
 * note recorded in Accounts is the same object this app streams back. Nothing is
 * copied between systems and the bucket stays private — each app serves files
 * through its own authenticated route.
 *
 * Deletion is not done here. The Accounts scheduler runs `chat:purge-media`
 * daily and removes objects past their 10-day expiry for BOTH systems, because
 * there is one bucket and one chat_attachments table.
 *
 * Deliberately separate from src/lib/storage.ts: that module writes permanent
 * operational uploads under `uploads/` and must never share a retention policy
 * with chat, where everything is deleted after ten days.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import { chatWrite, chatQueryOne } from './db'
import { BLOCKED_EXTENSIONS, CHAT_BUCKET, CHAT_PREFIX, CHAT_REGION, MAX_UPLOAD_MB, MEDIA_TTL_DAYS } from './config'
import type { RowDataPacket } from 'mysql2'

let client: S3Client | null = null
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: CHAT_REGION,
      // Path style: the bucket name contains a dot ("ops.aahaas"), which breaks
      // virtual-host TLS. The Accounts disk forces the same for the same reason.
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })
  }
  return client
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  webm: 'audio/webm', opus: 'audio/opus',
  mp4: 'video/mp4', mov: 'video/quicktime',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
}

/**
 * Classify an upload into the shapes the bubble knows how to draw.
 *
 * Extension first, because browsers are unreliable about the MIME type of an
 * .xlsx and hopeless about a recorded .webm.
 *
 * MUST match ChatAttachment::classify() in the Accounts app.
 */
export function classify(fileName: string, mime: string | null): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'avif'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'opus'].includes(ext)) return 'audio'
  if (ext === 'webm' || ext === 'weba') return (mime ?? '').startsWith('video') ? 'video' : 'audio'
  if (['mp4', 'mov', 'mkv', 'avi'].includes(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(ext)) return 'sheet'
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'doc'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
  if ((mime ?? '').startsWith('image/')) return 'image'
  if ((mime ?? '').startsWith('audio/')) return 'audio'
  if ((mime ?? '').startsWith('video/')) return 'video'
  return 'other'
}

export function contentTypeFor(name: string, fallback?: string | null): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return MIME[ext] ?? fallback ?? 'application/octet-stream'
}

/**
 * Store one upload and create its (not yet attached) chat_attachments row.
 *
 * The attachment exists before the message does — sendMessage() adopts the ids.
 * That ordering is what makes an interrupted upload harmless: an orphan row
 * renders nowhere and is cleared by the same 10-day sweep as everything else.
 */
export async function putChatFile(
  file: File,
  meta: { conversationId: number; durationMs?: number | null; waveform?: number[] | null },
): Promise<number> {
  const name = file.name || 'file'
  const ext = (name.split('.').pop() ?? 'bin').toLowerCase()

  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`“${name}” is larger than the ${MAX_UPLOAD_MB} MB limit.`)
  }
  // A deny list, not an allow list: the brief asks for any file type, so only
  // the things that execute rather than open are refused.
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    throw new Error(`.${ext} files cannot be shared in chat.`)
  }

  const key = `${CHAT_PREFIX}/${new Date().toISOString().slice(0, 7).replace('-', '/')}/${randomUUID()}.${ext}`
  const body = Buffer.from(await file.arrayBuffer())
  const contentType = contentTypeFor(name, file.type)

  await s3().send(new PutObjectCommand({
    Bucket: CHAT_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))

  const res = await chatWrite(
    `INSERT INTO \`chat_attachments\`
       (\`message_id\`,\`conversation_id\`,\`disk_key\`,\`file_name\`,\`mime\`,\`size_bytes\`,\`kind\`,
        \`duration_ms\`,\`waveform\`,\`expires_at\`,\`created_at\`,\`updated_at\`)
     VALUES (NULL,?,?,?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL ? DAY),NOW(),NOW())`,
    [
      meta.conversationId,
      key,
      name.slice(0, 250),
      contentType,
      body.length,
      classify(name, contentType),
      meta.durationMs ?? null,
      meta.waveform?.length ? JSON.stringify(meta.waveform) : null,
      // The 10-day rule, stamped at upload so every file carries its own
      // deadline and the sweep never has to recompute one.
      MEDIA_TTL_DAYS,
    ],
  )

  return res.insertId
}

/**
 * Every form a stored key can legitimately take, most likely first.
 *
 * The two systems disagreed about what `disk_key` means and both were
 * internally consistent, so each side served its own files and 410'd on the
 * other's:
 *
 *   ops       `chat/2026/08/x.png`   — the absolute object key, written here
 *   accounts  `2026/08/x.png`        — relative to its Laravel disk's `chat/` root
 *
 * The object sits in the same place either way; only the row's spelling
 * differs, so nothing is migrated — a read simply tries both. The Accounts half
 * is ChatMediaService::keyCandidates() and must keep agreeing with this.
 */
export function keyCandidates(key: string): string[] {
  const clean = key.trim().replace(/^\/+/, '')
  const prefix = CHAT_PREFIX.replace(/^\/+|\/+$/g, '')
  const out = [clean]

  if (prefix && !clean.startsWith(`${prefix}/`)) out.push(`${prefix}/${clean}`)

  return Array.from(new Set(out.filter(Boolean)))
}

async function readObject(key: string): Promise<Buffer | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: CHAT_BUCKET, Key: key }))
    const chunks: Buffer[] = []
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  } catch (err) {
    const code = (err as { name?: string; Code?: string })?.name ?? (err as { Code?: string })?.Code
    if (code !== 'NoSuchKey' && code !== 'NotFound') {
      console.error('[chat/storage] read failed', key, err)
    }
    return null
  }
}

/** Raw bytes for the media route. Null once the object has been purged. */
export async function getChatFile(key: string): Promise<Buffer | null> {
  for (const candidate of keyCandidates(key)) {
    const bytes = await readObject(candidate)
    if (bytes) return bytes
  }
  return null
}

/** The attachment row, for the media route's membership check. */
export async function attachmentRow(id: number) {
  return chatQueryOne<RowDataPacket & {
    id: number; conversation_id: number; disk_key: string; thumb_key: string | null
    file_name: string; mime: string | null; expires_at: string | null; purged_at: string | null
  }>('SELECT * FROM `chat_attachments` WHERE `id` = ? LIMIT 1', [id])
}
