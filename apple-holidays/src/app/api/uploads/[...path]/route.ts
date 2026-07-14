import { NextRequest, NextResponse } from 'next/server'
import { getUpload } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const relativePath = params.path.join('/')
  if (relativePath.includes('..') || relativePath.includes('\0')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const file = await getUpload(relativePath)
  if (!file) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(file.buffer, {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
