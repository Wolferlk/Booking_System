import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Only Ground Team can upload ticket files', 403)
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: params.id } })
  if (!ticket) return buildApiError('Ticket not found', 404)

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return buildApiError('No file provided')

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    return buildApiError('Only PDF, JPG, PNG, and WebP files are allowed')
  }

  if (file.size > 10 * 1024 * 1024) return buildApiError('File too large (max 10MB)')

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const safeName = `ticket-${params.id}-${Date.now()}.${ext}`
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'tickets')

  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, safeName), buffer)

  const fileUrl = `/uploads/tickets/${safeName}`
  const fileType = file.type.startsWith('image/') ? 'image' : 'pdf'

  const updated = await prisma.ticket.update({
    where: { id: params.id },
    data: { fileUrl, fileName: file.name, fileType },
  })

  await logActivity({
    userId: session.user.id,
    action: ACTION.TICKET_FILE_UPLOADED,
    entityType: 'Ticket',
    entityId: params.id,
    details: { fileName: file.name, fileType, ticketType: ticket.type },
  })

  return buildApiSuccess({ fileUrl, fileName: file.name, fileType }, 'File uploaded')
}
