/** Query Monitor — one run with its full step-by-step trace. */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import type { RunStep } from '@/lib/query-monitor/run'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const run = await prisma.queryMonitorRun.findUnique({ where: { id: params.id } })
  if (!run) return buildApiError('Run not found', 404)

  let steps: RunStep[] = []
  if (run.steps) {
    try {
      const parsed = JSON.parse(run.steps)
      if (Array.isArray(parsed)) steps = parsed as RunStep[]
    } catch {
      // A truncated blob should still show the run — just without its trace.
      steps = [{ t: run.startedAt.toISOString(), level: 'warn', msg: 'Step log could not be parsed' }]
    }
  }

  const entries = await prisma.queryMonitorEntry.findMany({
    where:   { firstRunId: run.id },
    orderBy: { receivedAt: 'asc' },
    select: {
      id: true, subject: true, handlerNames: true, salesPerson: true, agent: true,
      destination: true, receivedAt: true, sheetRow: true, syncStatus: true,
    },
    take: 200,
  })

  return buildApiSuccess({ run: { ...run, steps: undefined }, steps, entries })
}
