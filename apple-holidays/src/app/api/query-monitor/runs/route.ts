/** Query Monitor — the run history that backs the "View log" screen. */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const p = req.nextUrl.searchParams
  const take = Math.min(Number(p.get('limit') ?? '50'), 200)
  const status = p.get('status')

  // `steps` is a LongText blob per run — excluded from the list and fetched
  // only when a run is expanded.
  const runs = await prisma.queryMonitorRun.findMany({
    where:   status ? { status } : {},
    orderBy: { startedAt: 'desc' },
    take,
    select: {
      id: true, trigger: true, status: true, startedAt: true, finishedAt: true,
      durationMs: true, windowFrom: true, windowTo: true, mailboxesScanned: true,
      messagesSeen: true, entriesCreated: true, entriesUpdated: true,
      repliesDetected: true, rowsAppended: true, rowsUpdated: true,
      aiCalls: true, errors: true, errorMessage: true, triggeredBy: true,
    },
  })

  const since = new Date(Date.now() - 7 * 86_400_000)
  const recent = await prisma.queryMonitorRun.aggregate({
    where: { startedAt: { gte: since } },
    _sum:  { entriesCreated: true, rowsAppended: true, aiCalls: true, errors: true },
    _count: { _all: true },
  })

  return buildApiSuccess({
    runs,
    week: {
      runs:           recent._count._all,
      entriesCreated: recent._sum.entriesCreated ?? 0,
      rowsAppended:   recent._sum.rowsAppended   ?? 0,
      aiCalls:        recent._sum.aiCalls        ?? 0,
      errors:         recent._sum.errors         ?? 0,
    },
  })
}
