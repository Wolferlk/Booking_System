/**
 * Live Confirmation Watch — settings + status.
 *
 *   GET  → current settings, last/next check, rolling window and recent checks.
 *   POST → save { enabled, intervalMinutes, lookbackDays } and re-arm the loop.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import { getWatchStatus, getWatchSettings, saveWatchSettings } from '@/lib/as-watch'

export const dynamic = 'force-dynamic'

function guardRole(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:create')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  try {
    return buildApiSuccess(await getWatchStatus())
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load watch status', 500)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  let body: { enabled?: boolean; intervalMinutes?: number; lookbackDays?: number }
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const current = await getWatchSettings()
  const saved = await saveWatchSettings({
    enabled:         typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    intervalMinutes: Number.isFinite(body.intervalMinutes) ? Number(body.intervalMinutes) : current.intervalMinutes,
    lookbackDays:    Number.isFinite(body.lookbackDays)    ? Number(body.lookbackDays)    : current.lookbackDays,
  })

  // Re-arm the in-process loop so a changed interval takes effect now rather
  // than after the pending delay expires. Best-effort: on serverless there is no
  // long-lived process to re-arm and the cron route drives the watch instead.
  try {
    const { rescheduleAsWatch } = await import('@/lib/as-watch-scheduler')
    await rescheduleAsWatch()
  } catch (err) {
    console.error('[watch settings] reschedule failed:', err instanceof Error ? err.message : err)
  }

  return buildApiSuccess({ settings: saved }, 'Watch settings saved')
}
