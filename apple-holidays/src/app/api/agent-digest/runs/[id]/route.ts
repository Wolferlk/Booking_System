/**
 * GET /api/agent-digest/runs/:id — one frozen digest (what was sent) plus its
 * deliveries with the exact message bodies, for the history drawer.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { runLink } from '@/lib/agent-digest/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    const run = await prisma.agentDigestRun.findUnique({ where: { id: params.id } })
    if (!run) return buildApiError('Not found', 404)
    const sends = await prisma.agentDigestSend.findMany({
      where: { runId: run.id }, orderBy: { createdAt: 'asc' },
      select: { id: true, channel: true, recipient: true, recipientName: true, status: true, mode: true, subject: true, body: true, error: true, createdAt: true },
    })
    return buildApiSuccess({
      run: { id: run.id, ruleId: run.ruleId, ruleName: run.ruleName, runDate: run.runDate, trigger: run.trigger, createdAt: run.createdAt.toISOString(), createdByName: run.createdByName, payload: run.payload, link: runLink(run) },
      sends: sends.map(s => ({ ...s, createdAt: s.createdAt.toISOString() })),
    })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Failed', 500)
  }
}
