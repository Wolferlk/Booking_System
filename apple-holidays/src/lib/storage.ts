import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { readFile, mkdir, writeFile, readdir, stat } from 'fs/promises'
import path from 'path'

/**
 * Central storage for user-uploaded files (driver photos, tickets, bills,
 * destination images, generated WhatsApp PDFs, etc.).
 *
 * Files are stored in S3 under the `uploads/` key prefix and served through the
 * `/api/uploads/[...path]` route, so the public URL scheme (`/api/uploads/<cat>/<name>`)
 * is identical to the previous local-disk implementation — no DB changes are needed.
 *
 * A local-disk fallback is kept for backward compatibility: writes still mirror to
 * disk when S3 is unavailable, and reads fall back to disk for any legacy files that
 * were never migrated to the bucket.
 */

const BUCKET = process.env.S3_BUCKET
const REGION = process.env.S3_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-1'
const KEY_PREFIX = 'uploads'

export const s3Enabled = Boolean(
  BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY,
)

let _client: S3Client | null = null
function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: REGION,
      // Path-style addressing avoids TLS/SNI issues with dotted bucket names (e.g. "ops.aahaas").
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })
  }
  return _client
}

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function contentTypeFor(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

function localPath(relativePath: string): string {
  return path.join(process.cwd(), 'public', 'uploads', relativePath)
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // Node.js runtime: the SDK returns a Readable stream.
  const stream = body as AsyncIterable<Uint8Array>
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/**
 * Store an uploaded file. `relativePath` is the path under `uploads/`
 * (e.g. `photos/driver-123.jpg`). Returns the public URL (`/api/uploads/<relativePath>`).
 */
export async function putUpload(
  relativePath: string,
  body: Buffer,
  contentType?: string,
): Promise<string> {
  const ct = contentType ?? contentTypeFor(relativePath)

  if (s3Enabled) {
    try {
      await client().send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: `${KEY_PREFIX}/${relativePath}`,
          Body: body,
          ContentType: ct,
        }),
      )
      return `/api/uploads/${relativePath}`
    } catch (err) {
      console.error('[storage] S3 put failed, falling back to local disk:', err)
    }
  }

  // Fallback: local disk (best effort; disk may be read-only on some hosts).
  try {
    const fp = localPath(relativePath)
    await mkdir(path.dirname(fp), { recursive: true })
    await writeFile(fp, body)
  } catch (err) {
    console.error('[storage] local disk write failed:', err)
    if (!s3Enabled) throw err
  }
  return `/api/uploads/${relativePath}`
}

/**
 * Read a stored file. Tries S3 first, then falls back to local disk for legacy files.
 * Returns null if not found in either location.
 */
export async function getUpload(
  relativePath: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (s3Enabled) {
    try {
      const res = await client().send(
        new GetObjectCommand({ Bucket: BUCKET, Key: `${KEY_PREFIX}/${relativePath}` }),
      )
      const buffer = await streamToBuffer(res.Body)
      return { buffer, contentType: res.ContentType || contentTypeFor(relativePath) }
    } catch (err: any) {
      const code = err?.name || err?.Code
      if (code !== 'NoSuchKey' && code !== 'NotFound') {
        console.error('[storage] S3 get error, trying local disk:', err)
      }
    }
  }

  try {
    const buffer = await readFile(localPath(relativePath))
    return { buffer, contentType: contentTypeFor(relativePath) }
  } catch {
    return null
  }
}


/** One stored file, as a listing shows it. */
export interface StoredFile {
  /** Path under `uploads/` — what `getUpload` takes and the public URL carries. */
  path: string
  size: number
  modifiedAt: string | null
}

/**
 * Everything stored under one `uploads/` folder, newest first.
 *
 * Used where a folder *is* the collection — the settlement board's logo
 * gallery, where whatever has been uploaded is what the desk may choose from,
 * with no database table shadowing the bucket and going stale against it.
 *
 * S3 and the local-disk fallback are merged, because a file written before the
 * bucket existed is still a file the gallery should show. A folder that is
 * absent in both places is an empty list, not an error.
 */
export async function listUploads(prefix: string, limit = 200): Promise<StoredFile[]> {
  const clean = prefix.replace(/^\/+|\/+$/g, '')
  const found = new Map<string, StoredFile>()

  if (s3Enabled) {
    try {
      const res = await client().send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `${KEY_PREFIX}/${clean}/`,
        MaxKeys: Math.min(limit, 1000),
      }))
      for (const obj of res.Contents ?? []) {
        const key = obj.Key ?? ''
        const rel = key.slice(`${KEY_PREFIX}/`.length)
        if (!rel || key.endsWith('/')) continue
        found.set(rel, {
          path: rel,
          size: obj.Size ?? 0,
          modifiedAt: obj.LastModified ? obj.LastModified.toISOString() : null,
        })
      }
    } catch (err) {
      console.error('[storage] S3 list failed, falling back to local disk:', err)
    }
  }

  try {
    const dir = localPath(clean)
    for (const name of await readdir(dir)) {
      const rel = `${clean}/${name}`
      if (found.has(rel)) continue
      try {
        const st = await stat(path.join(dir, name))
        if (!st.isFile()) continue
        found.set(rel, { path: rel, size: st.size, modifiedAt: st.mtime.toISOString() })
      } catch { /* a file that vanished mid-listing is simply not listed */ }
    }
  } catch { /* no local folder — normal once everything lives in the bucket */ }

  return Array.from(found.values())
    .sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))
    .slice(0, limit)
}
