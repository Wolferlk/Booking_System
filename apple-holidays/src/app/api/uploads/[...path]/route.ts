import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const relativePath = params.path.join('/')
  if (relativePath.includes('..') || relativePath.includes('\0')) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  const filePath = path.join(process.cwd(), 'public', 'uploads', relativePath)

  try {
    const buffer = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
