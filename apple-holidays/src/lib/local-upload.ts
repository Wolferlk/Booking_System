import fs from 'fs/promises'
import path from 'path'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'photos')

// Reads a photo previously saved by /api/upload/photo (stored as /api/uploads/photos/<filename>)
// directly off disk, avoiding an HTTP round-trip during PDF/Word generation.
export async function readLocalUploadAsBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null
  const filename = url.split('/').pop()
  if (!filename) return null
  try {
    return await fs.readFile(path.join(UPLOAD_DIR, filename))
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
  const ext = url.split('.').pop()?.toLowerCase()
  return ext ? DOCX_IMAGE_TYPES[ext] ?? null : null
}
