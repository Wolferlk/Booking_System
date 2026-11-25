/**
 * Upcoming Arrivals update check — "Run now".
 *
 * Starts a check immediately, ignoring the master switch and the once-a-day
 * guard (a person asking *is* the decision), but still holding the run lock so
 * it can never overlap the scheduled run. Every safety rule of the daily run
 * applies: preview-then-apply, large-change holds, the circuit breaker, the
 * auto-apply switch. An optional `maxPerRun` bounds this run only.
 *
 * The check is throttled and can take several minutes on a busy book, so it
 * runs in the background; the panel polls the status route until it finishes.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import { runUpcomingSync, getUpSyncStatus } from '@/lib/as-upcoming-sync'

export const dynamic = 'force-dynamic'

function guardRole(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:edit')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  let body: { maxPerRun?: number } = {}
  try { body = await req.json() } catch { /* no body is fine */ }

  try {
    const before = await getUpSyncStatus()
    if (before.running) {
      return buildApiSuccess({ started: false, status: before }, 'A check is already running.')
    }

    void runUpcomingSync({
      mode: 'manual',
      ...(Number.isFinite(body.maxPerRun) && { maxPerRun: Number(body.maxPerRun) }),
    }).catch((err) => {
      console.error('[upcoming-sync run] background error:', err instanceof Error ? err.message : err)
    })

    // Give the run a moment to take its lock so the status shows it running.
    await new Promise((r) => setTimeout(r, 800))
    return buildApiSuccess({ started: true, status: await getUpSyncStatus() }, 'Check started — this panel updates when it finishes.')
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not start the check', 500)
  }
}
