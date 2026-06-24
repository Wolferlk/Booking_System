import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN', 'BT_USER'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const category = (formData.get('category') as string) || 'misc'

  if (!file) return buildApiError('No file provided')
  if (!ALLOWED_TYPES.includes(file.type)) return buildApiError('Only JPEG, PNG, WebP images allowed')
  if (file.size > MAX_SIZE) return buildApiError('File too large (max 5MB)')

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const filename = `${category}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'photos')

  await mkdir(uploadDir, { recursive: true })

  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(uploadDir, filename), buffer)

  const url = `/uploads/photos/${filename}`
  return buildApiSuccess({ url, filename }, 'Photo uploaded')
}
