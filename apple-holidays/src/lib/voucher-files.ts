/**
 * Ticket / voucher files, fetched and made printable for the booking PDFs.
 *
 * Why the Full Details PDF used to show no ticket images:
 *   1. it read files off local disk only — on Amplify the uploads live in S3,
 *      so every lookup came back empty;
 *   2. it only looked at `Ticket.fileUrl`, never the extra `ticket_files` rows
 *      (one per guest on a group ticket);
 *   3. PDFKit draws JPEG and PNG only — a PDF e-ticket or a WebP phone photo
 *      could never be drawn even when it was found.
 *
 * This module fixes all three: it reads through the same storage layer as the
 * /api/uploads route (S3 → disk → HTTP), sniffs the real file type from its
 * bytes, converts WebP/GIF to JPEG with the codecs Next ships, and opens PDF
 * tickets with pdf-lib so their pages can be stamped into the document.
 */
import { getUpload } from '@/lib/storage'
import { readUploadAsBuffer } from '@/lib/local-upload'
import { localUploadRelativePath } from '@/lib/upload-path'
import { loadTicketFiles } from '@/lib/ticket-files'

export type VoucherKind = 'image' | 'pdf' | 'unavailable'

export interface VoucherFile {
  url: string
  name: string | null
  label: string | null
  kind: VoucherKind
  /** JPEG/PNG bytes (kind 'image') or the original PDF bytes (kind 'pdf'). */
  buffer?: Buffer
  /** PDF only — how many pages it has (capped by the caller). */
  pageCount?: number
  /** Why it could not be attached, for the summary line. */
  reason?: string
}

function publicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    'https://ops.aahaas.com'
  ).replace(/\/+$/, '')
}

/** An absolute link a guest can open — `/api/uploads/...` served publicly. */
export function publicFileUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${publicBaseUrl()}${url.startsWith('/') ? '' : '/'}${url}`
}

/**
 * Read any stored upload: S3 (or disk) through the storage layer first, then
 * the old local/remote reader, then the public /api/uploads route itself — if
 * the dashboard can show the file, the PDF can find it.
 */
export async function readStoredUpload(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null
  const rel = localUploadRelativePath(url)
  if (rel?.startsWith('uploads/')) {
    try {
      const f = await getUpload(rel.slice('uploads/'.length))
      if (f?.buffer?.length) return f.buffer
    } catch { /* fall through */ }
  }
  const direct = await readUploadAsBuffer(url)
  if (direct?.length) return direct
  if (!/^https?:\/\//i.test(url) && url.startsWith('/api/uploads/')) {
    try {
      const res = await fetch(publicFileUrl(url), { signal: AbortSignal.timeout(10_000) })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
    } catch { /* give up */ }
  }
  return null
}

type Sniffed = 'jpeg' | 'png' | 'pdf' | 'webp' | 'gif' | 'other'

/** File type from the bytes — extensions and stored MIME types lie. */
export function sniffFile(buf: Buffer): Sniffed {
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg'
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png'
  if (buf.length >= 5 && buf.toString('latin1', 0, 1024).includes('%PDF-')) return 'pdf'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif'
  return 'other'
}

/**
 * WebP / GIF → JPEG using the WASM codecs bundled with Next (the same ones
 * next/image falls back to without sharp). Loaded at runtime, never bundled,
 * and any failure just means the voucher is linked instead of drawn.
 */
async function toJpeg(buf: Buffer): Promise<Buffer | null> {
  try {
    const req: NodeRequire = typeof (globalThis as any).__non_webpack_require__ === 'function'
      ? (globalThis as any).__non_webpack_require__
      : // eslint-disable-next-line no-eval
        eval('require')
    const squoosh = req('next/dist/server/lib/squoosh/main') as {
      processBuffer: (b: Buffer, ops: unknown[], enc: string, q: number) => Promise<Buffer>
    }
    const out = await Promise.race([
      squoosh.processBuffer(buf, [{ type: 'resize', width: 1800 }], 'jpeg', 85),
      new Promise<null>(r => setTimeout(() => r(null), 20_000)),
    ])
    return out && out.length ? Buffer.from(out) : null
  } catch (err) {
    console.warn('[voucher-files] image conversion unavailable:', (err as Error)?.message)
    return null
  }
}

async function prepare(url: string, name: string | null, label: string | null): Promise<VoucherFile> {
  const base = { url, name, label }
  const buf = await readStoredUpload(url)
  if (!buf) return { ...base, kind: 'unavailable', reason: 'file not found in storage' }

  const type = sniffFile(buf)
  if (type === 'jpeg' || type === 'png') return { ...base, kind: 'image', buffer: buf }

  if (type === 'webp' || type === 'gif') {
    const jpg = await toJpeg(buf)
    return jpg
      ? { ...base, kind: 'image', buffer: jpg }
      : { ...base, kind: 'unavailable', reason: `${type.toUpperCase()} image` }
  }

  if (type === 'pdf') {
    try {
      const { PDFDocument } = await import('pdf-lib')
      const src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })
      if (src.isEncrypted) return { ...base, kind: 'unavailable', reason: 'password-protected PDF' }
      const pageCount = src.getPageCount()
      if (!pageCount) return { ...base, kind: 'unavailable', reason: 'empty PDF' }
      return { ...base, kind: 'pdf', buffer: buf, pageCount }
    } catch {
      return { ...base, kind: 'unavailable', reason: 'PDF could not be read' }
    }
  }
  return { ...base, kind: 'unavailable', reason: 'unsupported file type' }
}

/**
 * Every file under each ticket — its receipt (`Ticket.fileUrl`) plus any
 * `ticket_files` rows — ready to draw, keyed by ticket id, in upload order.
 */
export async function loadVoucherFiles(
  tickets: { id: string; fileUrl?: string | null; fileName?: string | null }[],
): Promise<Map<string, VoucherFile[]>> {
  const extra = await loadTicketFiles(tickets.map(t => t.id))
  const out = new Map<string, VoucherFile[]>()
  await Promise.all(tickets.map(async t => {
    const seen = new Set<string>()
    const wanted: { url: string; name: string | null; label: string | null }[] = []
    if (t.fileUrl) { seen.add(t.fileUrl); wanted.push({ url: t.fileUrl, name: t.fileName ?? null, label: null }) }
    for (const f of extra[t.id] ?? []) {
      if (!f.fileUrl || seen.has(f.fileUrl)) continue
      seen.add(f.fileUrl)
      wanted.push({ url: f.fileUrl, name: f.fileName, label: f.label })
    }
    out.set(t.id, await Promise.all(wanted.map(w => prepare(w.url, w.name, w.label))))
  }))
  return out
}
