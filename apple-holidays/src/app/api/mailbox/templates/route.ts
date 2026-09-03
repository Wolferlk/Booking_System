import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox, toStringArray } from '@/lib/mailbox/guard'
import { inspectTokens } from '@/lib/mailbox/tokens'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  const activeOnly = req.nextUrl.searchParams.get('activeOnly') === 'true'
  const templates = await prisma.mailTemplate.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })
  return buildApiSuccess({ templates })
}

export async function POST(req: NextRequest) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return buildApiError('Invalid request body')

  const name    = String(body.name ?? '').trim()
  const subject = String(body.subject ?? '').trim()
  const bodyHtml = String(body.bodyHtml ?? '')
  if (!name)     return buildApiError('Template name is required')
  if (!subject)  return buildApiError('Subject is required')
  if (!bodyHtml.trim()) return buildApiError('Body is required')

  // A code the operator did not choose is derived from the name, then made
  // unique with a short suffix rather than rejected — nobody renaming a template
  // "Booking Update" for the second time wants a collision error.
  const requested = String(body.code ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const base = requested || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template'
  let code = base
  for (let n = 2; await prisma.mailTemplate.findUnique({ where: { code } }); n++) code = `${base}-${n}`

  const template = await prisma.mailTemplate.create({
    data: {
      code,
      name,
      description: body.description ? String(body.description) : null,
      category:    String(body.category ?? 'General').trim() || 'General',
      audience:    String(body.audience ?? 'AGENT'),
      subject,
      bodyHtml,
      ccEmails:    toStringArray(body.ccEmails),
      attachPdf:   body.attachPdf === true,
      isActive:    body.isActive !== false,
      sortOrder:   Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      createdBy:   gate.actor.email,
      updatedBy:   gate.actor.email,
    },
  })

  const { unknown } = inspectTokens(`${subject} ${bodyHtml}`)
  return buildApiSuccess(
    { template, unknownTokens: unknown },
    unknown.length ? `Saved — unrecognised tokens will be left as-is: ${unknown.join(', ')}` : 'Template created',
  )
}
