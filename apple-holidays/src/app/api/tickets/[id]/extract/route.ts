import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractTicketDetails } from '@/lib/openai'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { id } = await params
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { booking: { select: { bookingRef: true } } },
  })
  if (!ticket) return buildApiError('Ticket not found', 404)

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return buildApiError('No file provided')

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowedTypes.includes(file.type)) {
    return buildApiError('Only PDF, JPG, PNG, WebP, or GIF files are allowed')
  }
  if (file.size > 10 * 1024 * 1024) return buildApiError('File too large (max 10MB)')

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  // Save file locally
  const ext      = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const safeName = `ticket-${id}-${Date.now()}.${ext}`
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'tickets')
  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, safeName), buffer)

  const fileUrl  = `/uploads/tickets/${safeName}`
  const fileType = file.type.startsWith('image/') ? 'image' : 'pdf'

  // AI extraction
  let extracted: Awaited<ReturnType<typeof extractTicketDetails>> = {}
  if (process.env.OPENAI_API_KEY) {
    const base64 = buffer.toString('base64')
    extracted = await extractTicketDetails(base64, file.type, ticket.type)
  }

  return buildApiSuccess({
    fileUrl,
    fileName: file.name,
    fileType,
    extracted,
  })
}
