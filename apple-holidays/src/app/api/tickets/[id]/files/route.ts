import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import { putUpload } from '@/lib/storage'
import {
  loadTicketFiles, isTicketFilesMissing, TICKET_FILES_NOT_READY, TICKET_FILE_ROLES,
} from '@/lib/ticket-files'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024
/** One request's worth — a big group is uploaded in a couple of goes. */
const MAX_FILES_PER_UPLOAD = 30

/** The ticket's files (beside its one receipt in `Ticket.fileUrl`). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const files = await loadTicketFiles([params.id])
  return buildApiSuccess(files[params.id] ?? [])
}

/**
 * Add one or more files under the ticket — form field `files`, repeated.
 * Every file is checked before any is stored, so a bad one in the batch
 * uploads nothing rather than half the set.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!TICKET_FILE_ROLES.includes(session.user.role)) {
    return buildApiError('Only Ground Team can upload ticket files', 403)
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: params.id } })
  if (!ticket) return buildApiError('Ticket not found', 404)

  const form = await req.formData()
  const files = form.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f)
  if (!files.length) return buildApiError('No files provided')
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return buildApiError(`Up to ${MAX_FILES_PER_UPLOAD} files at a time`)
  }
  for (const f of files) {
    if (!ALLOWED_TYPES.includes(f.type)) return buildApiError(`${f.name}: only PDF, JPG, PNG and WebP files are allowed`)
    if (f.size > MAX_BYTES) return buildApiError(`${f.name}: file too large (max 10MB)`)
  }

  // Refuse before storing anything when the table is not there yet.
  let position: number
  try {
    const last = await prisma.ticketFile.findFirst({
      where: { ticketId: params.id }, orderBy: { position: 'desc' }, select: { position: true },
    })
    position = (last?.position ?? -1) + 1
  } catch (err) {
    if (isTicketFilesMissing(err)) return buildApiError(TICKET_FILES_NOT_READY, 503)
    throw err
  }

  const uploaderName = session.user.name || session.user.email || null
  const created = []
  for (let n = 0; n < files.length; n++) {
    const f = files[n]
    const buffer = Buffer.from(await f.arrayBuffer())
    const ext = f.name.split('.').pop()?.toLowerCase() ?? 'bin'
    const fileUrl = await putUpload(`tickets/ticket-${params.id}-${Date.now()}-${n}.${ext}`, buffer, f.type)
    created.push(await prisma.ticketFile.create({
      data: {
        ticketId: params.id,
        fileUrl,
        fileName: f.name.slice(0, 255),
        fileType: f.type.startsWith('image/') ? 'image' : 'pdf',
        label: f.name.replace(/\.[^.]+$/, '').slice(0, 191),
        position: position + n,
        uploadedById: session.user.id,
        uploadedByName: uploaderName,
      },
    }))
  }

  await logActivity({
    userId: session.user.id,
    action: ACTION.TICKET_FILE_UPLOADED,
    entityType: 'Ticket',
    entityId: params.id,
    details: { fileNames: files.map(f => f.name), count: files.length, ticketType: ticket.type },
  })

  return buildApiSuccess(created, `${created.length} file${created.length === 1 ? '' : 's'} added`)
}

/** Rename a file's label — body `{ fileId, label }`. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!TICKET_FILE_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { fileId, label } = await req.json()
  if (!fileId) return buildApiError('fileId is required')
  try {
    const { count } = await prisma.ticketFile.updateMany({
      where: { id: String(fileId), ticketId: params.id },
      data: { label: String(label ?? '').trim().slice(0, 191) || null },
    })
    if (!count) return buildApiError('File not found', 404)
  } catch (err) {
    if (isTicketFilesMissing(err)) return buildApiError(TICKET_FILES_NOT_READY, 503)
    throw err
  }
  return buildApiSuccess(null, 'Saved')
}

/** Remove one file from the ticket — `?fileId=`. The stored upload is kept. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!TICKET_FILE_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const fileId = req.nextUrl.searchParams.get('fileId')
  if (!fileId) return buildApiError('fileId is required')
  try {
    const { count } = await prisma.ticketFile.deleteMany({ where: { id: fileId, ticketId: params.id } })
    if (!count) return buildApiError('File not found', 404)
  } catch (err) {
    if (isTicketFilesMissing(err)) return buildApiError(TICKET_FILES_NOT_READY, 503)
    throw err
  }
  return buildApiSuccess(null, 'File removed')
}
