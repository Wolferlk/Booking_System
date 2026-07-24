import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return { error: buildApiError('Forbidden', 403) }
  return { session }
}

/**
 * PATCH — approve / activate / deactivate, or edit a file handler.
 * body.action ∈ { approve, deactivate } is a shortcut; otherwise any of
 * { name, email, phone, whatsappPhone, country, password } is applied.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, error } = await requireAdmin()
  if (error) return error

  const handler = await prisma.fileHandler.findUnique({ where: { id: params.id } })
  if (!handler) return buildApiError('File handler not found', 404)

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.action === 'approve') {
    data.isActive = true
    data.approvedAt = new Date()
    data.approvedBy = session!.user.name ?? session!.user.email ?? 'admin'
  } else if (body.action === 'deactivate') {
    data.isActive = false
  } else {
    if (typeof body.name === 'string')          data.name = body.name.trim()
    if (typeof body.email === 'string')         data.email = body.email.trim().toLowerCase()
    if (typeof body.phone === 'string')         data.phone = body.phone.trim() || null
    if (typeof body.whatsappPhone === 'string') data.whatsappPhone = body.whatsappPhone.trim() || null
    if (typeof body.country === 'string')       data.country = body.country as OperationCountry
    if (typeof body.isActive === 'boolean')     data.isActive = body.isActive
    if (typeof body.password === 'string' && body.password.length >= 6) data.password = await bcrypt.hash(body.password, 10)
  }

  if (Object.keys(data).length === 0) return buildApiError('Nothing to update')

  // Guard against email collisions on rename.
  if (typeof data.email === 'string') {
    const clash = await prisma.fileHandler.findFirst({ where: { email: data.email as string, id: { not: params.id } } })
    if (clash) return buildApiError('Another file handler already uses that email')
  }

  const updated = await prisma.fileHandler.update({
    where: { id: params.id },
    data,
    select: { id: true, name: true, email: true, isActive: true },
  })
  return buildApiSuccess(updated, body.action === 'approve' ? 'File handler approved' : 'File handler updated')
}

// DELETE — remove a file handler. Their audit logs are kept (fileHandlerId set null).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireAdmin()
  if (error) return error

  const handler = await prisma.fileHandler.findUnique({ where: { id: params.id } })
  if (!handler) return buildApiError('File handler not found', 404)

  await prisma.fileHandler.delete({ where: { id: params.id } })
  return buildApiSuccess(null, 'File handler deleted')
}
