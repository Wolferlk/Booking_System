/**
 * GET /api/agent-digest — the designer's overview: saved digests, today's send
 * counters and whether the tables exist yet.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { isDigestTableMissing, listRules, SETUP_MESSAGE, TEMPLATE_AGENT_DIGEST } from '@/lib/agent-digest/server'
import { addDays, todayIn } from '@/lib/agent-digest/shared'

export const dynamic = 'force-dynamic'

export async function GET() {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const today = todayIn('Asia/Colombo')
  try {
    const [rules, sends] = await Promise.all([
      listRules(),
      prisma.agentDigestSend.groupBy({
        by: ['runDate', 'status'],
        where: { runDate: { gte: addDays(today, -1), lte: today }, trigger: { not: 'test' } },
        _count: { _all: true },
      }),
    ])
    const counters = { today: { sent: 0, failed: 0 }, yesterday: { sent: 0, failed: 0 } }
    for (const s of sends) {
      const bucket = s.runDate === today ? counters.today : counters.yesterday
      if (s.status === 'sent') bucket.sent += s._count._all
      if (s.status === 'failed') bucket.failed += s._count._all
    }
    return buildApiSuccess({ setupRequired: false, setupMessage: null, rules, counters, today, templateName: TEMPLATE_AGENT_DIGEST, me: staff.name })
  } catch (err) {
    if (isDigestTableMissing(err)) {
      return buildApiSuccess({ setupRequired: true, setupMessage: SETUP_MESSAGE, rules: [], counters: null, today, templateName: TEMPLATE_AGENT_DIGEST, me: staff.name })
    }
    return buildApiError(err instanceof Error ? err.message : 'Failed to load', 500)
  }
}
