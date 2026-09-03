import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox, toStringArray } from '@/lib/mailbox/guard'
import { inspectTokens } from '@/lib/mailbox/tokens'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const existing = await prisma.mailTemplate.findUnique({ where: { id: params.id } })
  if (!existing) return buildApiError('Template not found', 404)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return buildApiError('Invalid request body')

  const data: Record<string, unknown> = { updatedBy: gate.actor.email }
  if (body.name        !== undefined) data.name        = String(body.name).trim() || existing.name
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null
  if (body.category    !== undefined) data.category    = String(body.category).trim() || 'General'
  if (body.audience    !== undefined) data.audience    = String(body.audience)
  if (body.subject     !== undefined) data.subject     = String(body.subject)
  if (body.bodyHtml    !== undefined) data.bodyHtml    = String(body.bodyHtml)
  if (body.ccEmails    !== undefined) data.ccEmails    = toStringArray(body.ccEmails)
  if (body.attachPdf   !== undefined) data.attachPdf   = body.attachPdf === true
  if (body.isActive    !== undefined) data.isActive    = body.isActive === true
  if (body.sortOrder   !== undefined && Number.isFinite(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder)

  const template = await prisma.mailTemplate.update({ where: { id: params.id }, data })
  const { unknown } = inspectTokens(`${template.subject} ${template.bodyHtml}`)
  return buildApiSuccess({ template, unknownTokens: unknown }, 'Template saved')
}

/**
 * Templates are retired, not erased. Threads reference the template they were
 * sent from, and losing that reference would leave the outbox unable to say
 * what a message was — so an in-use template is deactivated instead, which is
 * what "delete" means to an operator anyway.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const template = await prisma.mailTemplate.findUnique({ where: { id: params.id } })
  if (!template) return buildApiError('Template not found', 404)

  const used = await prisma.mailThread.count({ where: { templateId: params.id } })
  if (used > 0) {
    await prisma.mailTemplate.update({ where: { id: params.id }, data: { isActive: false, updatedBy: gate.actor.email } })
    return buildApiSuccess({ deleted: false, deactivated: true, used },
      `Used by ${used} sent mail${used === 1 ? '' : 's'} — deactivated instead of deleted, so the history stays readable.`)
  }

  await prisma.mailTemplate.delete({ where: { id: params.id } })
  return buildApiSuccess({ deleted: true }, 'Template deleted')
}
