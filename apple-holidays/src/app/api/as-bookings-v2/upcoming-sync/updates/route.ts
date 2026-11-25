/**
 * Upcoming Arrivals update check — what changed, and what is waiting.
 *
 *   GET ?range=today|yesterday|7d   → bookings refreshed from AppleSystem in that
 *                                     range (any path: daily check, pre-arrival,
 *                                     parity check or manual), with before → after
 *   GET ?range=review               → updates found but held back, for a person
 *
 * Read-only.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { dateInTz, shiftDay, listUpdatesBetween, getPendingUpdates } from '@/lib/as-update-log'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT' || !hasPermission(session.user.role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  const range = req.nextUrl.searchParams.get('range') ?? 'yesterday'
  try {
    if (range === 'review') {
      const pending = Array.from((await getPendingUpdates()).values()).sort((a, b) => b.at.localeCompare(a.at))
      return buildApiSuccess({ range, pending })
    }
    const today = dateInTz()
    const [from, to] =
      range === 'today' ? [today, today]
        : range === '7d' ? [shiftDay(today, -6), today]
        : [shiftDay(today, -1), shiftDay(today, -1)]
    return buildApiSuccess({ range, from, to, updates: await listUpdatesBetween(from, to) })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load updates', 500)
  }
}
