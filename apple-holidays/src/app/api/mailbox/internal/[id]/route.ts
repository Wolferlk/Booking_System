import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox } from '@/lib/mailbox/guard'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const existing = await prisma.mailInternalRecipient.findUnique({ where: { id: params.id } })
  if (!existing) return buildApiError('Recipient not found', 404)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return buildApiError('Invalid request body')

  const data: Record<string, unknown> = {}
  if (body.name  !== undefined) data.name = String(body.name).trim() || existing.name
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase()
    if (!email.includes('@')) return buildApiError('A valid email is required')
    if (email !== existing.email) {
      const clash = await prisma.mailInternalRecipient.findUnique({ where: { email } })
      if (clash) return buildApiError(`${email} is already on the internal list`)
    }
    data.email = email
  }
  if (body.team     !== undefined) data.team     = body.team ? String(body.team) : null
  if (body.alwaysCc !== undefined) data.alwaysCc = body.alwaysCc === true
  if (body.isActive !== undefined) data.isActive = body.isActive === true
  if (body.notes    !== undefined) data.notes    = body.notes ? String(body.notes) : null

  const recipient = await prisma.mailInternalRecipient.update({ where: { id: params.id }, data })
  return buildApiSuccess({ recipient }, 'Saved')
}

/**
 * Safe to delete outright: threads store the CC line as sent text, so removing
 * someone from the list changes who gets copied from now on without rewriting
 * what already went out.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const existing = await prisma.mailInternalRecipient.findUnique({ where: { id: params.id } })
  if (!existing) return buildApiError('Recipient not found', 404)

  await prisma.mailInternalRecipient.delete({ where: { id: params.id } })
  return buildApiSuccess({ deleted: true }, 'Removed from the internal list')
}
