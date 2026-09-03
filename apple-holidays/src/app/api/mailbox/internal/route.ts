import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox } from '@/lib/mailbox/guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  const recipients = await prisma.mailInternalRecipient.findMany({
    orderBy: [{ isActive: 'desc' }, { alwaysCc: 'desc' }, { team: 'asc' }, { name: 'asc' }],
  })
  return buildApiSuccess({ recipients })
}

export async function POST(req: NextRequest) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return buildApiError('Invalid request body')

  const name  = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!name) return buildApiError('Name is required')
  if (!email.includes('@')) return buildApiError('A valid email is required')

  const clash = await prisma.mailInternalRecipient.findUnique({ where: { email } })
  if (clash) return buildApiError(`${email} is already on the internal list`)

  const recipient = await prisma.mailInternalRecipient.create({
    data: {
      name, email,
      team:     body.team ? String(body.team) : null,
      alwaysCc: body.alwaysCc !== false,
      isActive: body.isActive !== false,
      notes:    body.notes ? String(body.notes) : null,
      createdBy: gate.actor.email,
    },
  })
  return buildApiSuccess({ recipient }, 'Internal recipient added')
}
