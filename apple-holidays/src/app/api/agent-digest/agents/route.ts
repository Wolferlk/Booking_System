/**
 * GET /api/agent-digest/agents — agent names seen on bookings travelling in the
 * last 60 / next 120 days, with counts, for the agent picker. Read-only.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    const now = Date.now()
    const rows = await prisma.booking.groupBy({
      by: ['agent'],
      where: {
        agent: { not: null },
        arrivalDate: { gte: new Date(now - 60 * 86_400_000), lte: new Date(now + 120 * 86_400_000) },
        status: { notIn: ['CANCELLED', 'DRAFT'] },
      },
      _count: { _all: true },
    })
    const agents = rows
      .filter(r => r.agent?.trim())
      .map(r => ({ name: r.agent!.trim(), count: r._count._all }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 80)
    return buildApiSuccess({ agents })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Failed', 500)
  }
}
