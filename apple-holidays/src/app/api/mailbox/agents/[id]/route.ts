import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox, toStringArray } from '@/lib/mailbox/guard'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const existing = await prisma.mailAgent.findUnique({ where: { id: params.id } })
  if (!existing) return buildApiError('Agent not found', 404)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return buildApiError('Invalid request body')

  const data: Record<string, unknown> = { updatedBy: gate.actor.email }
  if (body.name         !== undefined) data.name         = String(body.name).trim() || existing.name
  if (body.company      !== undefined) data.company      = body.company ? String(body.company) : null
  if (body.primaryEmail !== undefined) {
    const email = String(body.primaryEmail).trim()
    if (!email.includes('@')) return buildApiError('A valid primary email is required')
    data.primaryEmail = email
  }
  if (body.ccEmails  !== undefined) data.ccEmails  = toStringArray(body.ccEmails)
  if (body.matchKeys !== undefined) data.matchKeys = toStringArray(body.matchKeys)
  if (body.country   !== undefined) data.country   = body.country ? String(body.country) : null
  if (body.phone     !== undefined) data.phone     = body.phone ? String(body.phone) : null
  if (body.notes     !== undefined) data.notes     = body.notes ? String(body.notes) : null
  if (body.isActive  !== undefined) data.isActive  = body.isActive === true

  const agent = await prisma.mailAgent.update({ where: { id: params.id }, data })
  return buildApiSuccess({ agent }, 'Agent saved')
}

/** Same reasoning as templates: an agent with correspondence is deactivated. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const agent = await prisma.mailAgent.findUnique({ where: { id: params.id } })
  if (!agent) return buildApiError('Agent not found', 404)

  const used = await prisma.mailThread.count({ where: { agentId: params.id } })
  if (used > 0) {
    await prisma.mailAgent.update({ where: { id: params.id }, data: { isActive: false, updatedBy: gate.actor.email } })
    return buildApiSuccess({ deleted: false, deactivated: true, used },
      `${used} mail${used === 1 ? '' : 's'} on file — deactivated instead of deleted, so the history stays readable.`)
  }

  await prisma.mailAgent.delete({ where: { id: params.id } })
  return buildApiSuccess({ deleted: true }, 'Agent removed')
}
