import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox, toStringArray } from '@/lib/mailbox/guard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  const q = req.nextUrl.searchParams.get('q')?.trim()
  const agents = await prisma.mailAgent.findMany({
    where: {
      ...(req.nextUrl.searchParams.get('activeOnly') === 'true' ? { isActive: true } : {}),
      ...(q ? { OR: [
        { name:         { contains: q } },
        { company:      { contains: q } },
        { primaryEmail: { contains: q } },
      ] } : {}),
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })

  // How much mail each agent has actually received — the one number that tells
  // a maintainer whether a directory row is real or a stale duplicate.
  const counts = await prisma.mailThread.groupBy({
    by: ['agentId'],
    _count: { _all: true },
    where: { agentId: { in: agents.map(a => a.id) } },
  })
  const countBy = new Map(counts.map(c => [c.agentId, c._count._all]))

  return buildApiSuccess({
    agents: agents.map(a => ({ ...a, threadCount: countBy.get(a.id) ?? 0 })),
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return buildApiError('Invalid request body')

  const name  = String(body.name ?? '').trim()
  const email = String(body.primaryEmail ?? '').trim()
  if (!name)  return buildApiError('Agent name is required')
  if (!email.includes('@')) return buildApiError('A valid primary email is required')

  const agent = await prisma.mailAgent.create({
    data: {
      name,
      company:      body.company ? String(body.company).trim() : null,
      primaryEmail: email,
      ccEmails:     toStringArray(body.ccEmails),
      matchKeys:    toStringArray(body.matchKeys),
      country:      body.country ? String(body.country) : null,
      phone:        body.phone ? String(body.phone) : null,
      notes:        body.notes ? String(body.notes) : null,
      isActive:     body.isActive !== false,
      createdBy:    gate.actor.email,
      updatedBy:    gate.actor.email,
    },
  })
  return buildApiSuccess({ agent }, 'Agent added')
}
