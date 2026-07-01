import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
const MAX_SIZE = 5 * 1024 * 1024

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file) return buildApiError('No file provided')
  if (!ALLOWED_TYPES.includes(file.type)) return buildApiError('Only JPEG, PNG, WebP images allowed')
  if (file.size > MAX_SIZE) return buildApiError('File too large (max 5MB)')

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const filename = `driver-reg-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'photos')

  await mkdir(uploadDir, { recursive: true })

  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(uploadDir, filename), buffer)

  return buildApiSuccess({ url: `/uploads/photos/${filename}` }, 'Photo uploaded')
}
