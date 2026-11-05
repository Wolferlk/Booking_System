import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ACTIONS = ['FLIGHTS_PROTECTED', 'FLIGHTS_RESTORED', 'BOOKING_SECTION_LOCKED', 'BOOKING_SECTION_UNLOCKED']
/** Bounded window so the createdAt index carries the query — activity_logs is large. */
const WINDOW_DAYS = 30

function summarise(action: string, d: Record<string, unknown>): string {
  switch (action) {
    case 'FLIGHTS_PROTECTED':
      return d.mode === 'locked'
        ? `Flights locked — ${d.source ?? 're-sync'} left them alone`
        : `${d.source ?? 'Re-sync'} kept ${d.kept} hand-entered flight(s)${Array.isArray(d.keptFlightNos) && d.keptFlightNos.length ? `: ${(d.keptFlightNos as string[]).join(', ')}` : ''}`
    case 'FLIGHTS_RESTORED':
      return `Restored ${Array.isArray(d.restored) ? (d.restored as { flightNo: string }[]).map(f => f.flightNo).join(', ') : 'flights'}`
    case 'BOOKING_SECTION_LOCKED':
      return `Locked ${d.section}${d.note ? ` — “${d.note}”` : ''}`
    case 'BOOKING_SECTION_UNLOCKED':
      return `Unlocked ${d.section}`
    default:
      return action
  }
}

// GET /api/admin/data-protection/activity — what data protection did lately.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const rows = await prisma.activityLog.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - WINDOW_DAYS * 86_400_000) },
      action: { in: ACTIONS },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, createdAt: true, action: true, details: true, user: { select: { name: true } } },
  })

  return buildApiSuccess({
    rows: rows.map(r => {
      let d: Record<string, unknown> = {}
      try { d = r.details ? JSON.parse(r.details) : {} } catch { d = {} }
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        user: r.user?.name ?? null,
        bookingRef: typeof d.bookingRef === 'string' ? d.bookingRef : null,
        summary: summarise(r.action, d),
      }
    }),
  })
}
