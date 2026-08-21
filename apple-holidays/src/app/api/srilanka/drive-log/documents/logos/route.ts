/**
 * The logo gallery the name board is printed with.
 *
 *   GET   the marks that may be printed: the ones that ship with the app, and
 *         everything the desk has uploaded into the bucket.
 *   POST  a new mark (multipart, field `file`), stored under
 *         `uploads/branding/logos/` and returned ready to select.
 *
 * ---- Why the bucket is the gallery ----
 *
 * There is no table of logos. The folder *is* the list, so a mark uploaded on
 * one machine is on the gallery of every other one immediately, and nothing can
 * drift out of step with what is actually stored. The name board keeps only the
 * path of the mark it prints.
 *
 * ---- What may be uploaded ----
 *
 * Raster images only — PNG, JPEG or WebP — under 3 MB, and the bytes are
 * checked against their magic numbers rather than trusted from the browser's
 * content type. SVG is deliberately refused: these files are served back from
 * an app route, and an SVG is a script-bearing document.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { listUploads, putUpload } from '@/lib/storage'
import { BUILTIN_LOGOS, LOGO_UPLOAD_DIR } from '@/lib/sl-settlement-docs'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 3 * 1024 * 1024

const canWrite = (role: UserRole) =>
  hasPermission(role, 'assignment:edit') || hasPermission(role, 'pnl:view_profit')

/** The real type of the bytes, or null when they are not an image we print. */
function sniff(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' }
  }
  return null
}

/** "Sun Travels Logo.png" → "sun-travels-logo". Empty names get one anyway. */
function slug(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase()
  const s = stem.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return s || 'logo'
}

/** A stored file's public URL and the name shown under it in the gallery. */
function galleryEntry(file: { path: string; modifiedAt: string | null }) {
  const base = file.path.split('/').pop() ?? file.path
  // Strip the uniqueness suffix the upload added back off for the caption.
  const label = base.replace(/\.[^.]+$/, '').replace(/-[a-z0-9]{6,}$/i, '').replace(/-/g, ' ')
  return {
    url: `/api/uploads/${file.path}`,
    label: label || base,
    uploadedAt: file.modifiedAt,
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  try {
    const files = await listUploads(LOGO_UPLOAD_DIR)
    return buildApiSuccess({
      builtin: BUILTIN_LOGOS,
      uploaded: files
        .filter(f => /\.(png|jpe?g|webp)$/i.test(f.path))
        .map(galleryEntry),
      canUpload: canWrite(role),
    })
  } catch (err) {
    console.error('[drive-log/documents/logos GET]', err)
    return buildApiError('The logo gallery could not be read.', 500)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!canWrite(role)) {
    return buildApiError('Only the operations desk, Accounts and admins may add logos.', 403)
  }

  let file: File | null = null
  try {
    const form = await req.formData()
    const candidate = form.get('file')
    if (candidate instanceof File) file = candidate
  } catch {
    return buildApiError('The upload could not be read.', 400)
  }
  if (!file) return buildApiError('No file was sent.', 400)
  if (file.size > MAX_BYTES) return buildApiError('A logo must be under 3 MB.', 400)

  const buf = Buffer.from(await file.arrayBuffer())
  const kind = sniff(buf)
  if (!kind) return buildApiError('A logo must be a PNG, JPEG or WebP image.', 400)

  try {
    const name = `${slug(file.name || 'logo')}-${Date.now().toString(36)}.${kind.ext}`
    const url = await putUpload(`${LOGO_UPLOAD_DIR}/${name}`, buf, kind.mime)
    return buildApiSuccess({
      logo: { url, label: slug(file.name || 'logo').replace(/-/g, ' '), uploadedAt: new Date().toISOString() },
    })
  } catch (err) {
    console.error('[drive-log/documents/logos POST]', err)
    return buildApiError('The logo could not be stored.', 500)
  }
}
