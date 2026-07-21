import fs from 'fs/promises'
import path from 'path'
import { localUploadRelativePath } from './upload-path'

// Reads a photo previously saved by /api/upload/photo (stored as /api/uploads/photos/<filename>)
// directly off disk, avoiding an HTTP round-trip during PDF/Word generation.
export async function readLocalUploadAsBuffer(url: string | null | undefined): Promise<Buffer | null> {
  const relPath = localUploadRelativePath(url)
  if (!relPath) return null
  try {
    return await fs.readFile(path.join(process.cwd(), 'public', relPath))
  } catch {
    return null
  }
}

/**
 * Same as readLocalUploadAsBuffer, but also handles files that live off-box
 * (S3/CDN URLs). Ticket scans can be either, depending on whether S3 storage was
 * enabled when they were uploaded, so document builders need both paths.
 */
export async function readUploadAsBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null
  const local = await readLocalUploadAsBuffer(url)
  if (local) return local
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

// docx's ImageRun only accepts jpg/png/gif/bmp — webp uploads fall back to text-only rendering.
const DOCX_IMAGE_TYPES: Record<string, 'jpg' | 'png' | 'gif' | 'bmp'> = {
  jpg: 'jpg', jpeg: 'jpg', png: 'png', gif: 'gif', bmp: 'bmp',
}
export function getDocxImageType(url: string | null | undefined): 'jpg' | 'png' | 'gif' | 'bmp' | null {
  if (!url) return null
  const ext = url.split('.').pop()?.toLowerCase()?.replace(/\?.*$/, '')
  return ext ? DOCX_IMAGE_TYPES[ext] ?? null : null
}

/**
 * Intrinsic pixel size of a png/jpeg/gif/bmp buffer, read from its header.
 * docx's ImageRun demands explicit width/height, so without this a portrait
 * ticket scan gets squashed into whatever box we guessed. Returns null when the
 * format isn't recognised — callers should fall back to a fixed box then.
 */
export function imageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    // PNG
    if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    // GIF
    if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    }
    // BMP
    if (buffer.length > 26 && buffer.toString('ascii', 0, 2) === 'BM') {
      return { width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) }
    }
    // JPEG — walk the segment markers to the start-of-frame
    if (buffer.length > 4 && buffer.readUInt16BE(0) === 0xffd8) {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset++; continue }
        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        const isSof = marker >= 0xc0 && marker <= 0xcf
          && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        if (isSof) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
        }
        offset += 2 + length
      }
    }
  } catch {
    // Truncated/corrupt file — treat as unknown rather than failing the document.
  }
  return null
}

/** Fit an image inside a box while keeping its aspect ratio. */
export function fitImage(
  intrinsic: { width: number; height: number } | null,
  box: { width: number; height: number },
): { width: number; height: number } {
  if (!intrinsic || intrinsic.width <= 0 || intrinsic.height <= 0) return box
  const scale = Math.min(box.width / intrinsic.width, box.height / intrinsic.height, 1)
  return {
    width: Math.max(1, Math.round(intrinsic.width * scale)),
    height: Math.max(1, Math.round(intrinsic.height * scale)),
  }
}
