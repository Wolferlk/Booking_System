/** Query Monitor — update or delete one sender rule. */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const rule = await prisma.queryMonitorSenderRule.findUnique({ where: { id: params.id } })
  if (!rule) return buildApiError('Rule not found', 404)

  const body = await req.json() as {
    pattern?: string; matchType?: string; salesPerson?: string; agent?: string
    region?: string | null; destination?: string | null; priority?: number
    isActive?: boolean; notes?: string | null
  }

  const pattern = body.pattern?.trim().toLowerCase().replace(/^@/, '')
  if (pattern !== undefined && !pattern) return buildApiError('Pattern cannot be empty')

  if (pattern && pattern !== rule.pattern) {
    const clash = await prisma.queryMonitorSenderRule.findUnique({ where: { pattern } })
    if (clash) return buildApiError(`A rule for "${pattern}" already exists`, 409)
  }

  const updated = await prisma.queryMonitorSenderRule.update({
    where: { id: rule.id },
    data: {
      ...(pattern            !== undefined ? { pattern } : {}),
      ...(body.matchType     !== undefined ? { matchType: body.matchType === 'EMAIL' ? 'EMAIL' : 'DOMAIN' } : {}),
      ...(body.salesPerson   !== undefined ? { salesPerson: body.salesPerson.trim() } : {}),
      ...(body.agent         !== undefined ? { agent: body.agent.trim() } : {}),
      ...(body.region        !== undefined ? { region: body.region?.trim() || null } : {}),
      ...(body.destination   !== undefined ? { destination: body.destination?.trim() || null } : {}),
      ...(body.priority      !== undefined ? { priority: body.priority } : {}),
      ...(body.isActive      !== undefined ? { isActive: body.isActive } : {}),
      ...(body.notes         !== undefined ? { notes: body.notes?.trim() || null } : {}),
    },
  })

  return buildApiSuccess({ rule: updated }, 'Rule updated')
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const rule = await prisma.queryMonitorSenderRule.findUnique({ where: { id: params.id } })
  if (!rule) return buildApiError('Rule not found', 404)

  await prisma.queryMonitorSenderRule.delete({ where: { id: rule.id } })
  return buildApiSuccess(null, 'Rule deleted — future mail from that sender falls back to "Others"')
}
