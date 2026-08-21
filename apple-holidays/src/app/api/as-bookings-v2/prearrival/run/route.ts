/**
 * Pre-Arrival Sync — "Run now".
 *
 * Runs the sweep immediately, ignoring the enabled switch and the once-a-day
 * guard (an operator asking for it *is* the decision), but still respecting the
 * run lock so it cannot overlap the scheduled run. An optional `daysBefore`
 * overrides the lead time for this run only, without saving it.
 *
 * Runs synchronously: the sweep is throttled and can take a while on a heavy
 * arrival day, so the caller gets the finished run summary back.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import { runPreArrivalSync, getPreSyncStatus, MIN_DAYS, MAX_DAYS } from '@/lib/as-prearrival-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function guardRole(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:edit')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  let body: { daysBefore?: number; targetDate?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* no body is fine — use the saved settings */
  }

  const daysBefore = Number.isFinite(body.daysBefore)
    ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.trunc(Number(body.daysBefore))))
    : undefined
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate ?? '') ? body.targetDate : undefined

  try {
    const run = await runPreArrivalSync({ mode: 'manual', daysBefore, targetDate })
    const status = await getPreSyncStatus()

    if (!run) {
      return buildApiSuccess({ ran: false, status }, 'A sync run is already in progress.')
    }

    const message = run.scanned === 0
      ? `No live bookings arrive on ${run.targetDate}.`
      : `${run.updated} updated, ${run.unchanged} already current, ${run.failed} failed.`

    return buildApiSuccess({ ran: true, run, status }, message)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Sync run failed', 500)
  }
}
