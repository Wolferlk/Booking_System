import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Only Accounts Team can upload payment bills', 403)
  }

  const line = await prisma.pNLLineItem.findUnique({ where: { id: params.id } })
  if (!line) return buildApiError('PNL line not found', 404)

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return buildApiError('No file provided')

  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) return buildApiError('Only PDF, JPG, PNG, WebP allowed')
  if (file.size > 10 * 1024 * 1024) return buildApiError('File too large (max 10MB)')

  const ext     = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const safeName = `bill-${params.id}-${Date.now()}.${ext}`
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'bills')

  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, safeName), Buffer.from(await file.arrayBuffer()))

  const fileUrl = `/uploads/bills/${safeName}`

  return buildApiSuccess({ fileUrl, fileName: file.name })
}
