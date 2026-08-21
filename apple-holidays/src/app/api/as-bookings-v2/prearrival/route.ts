/**
 * Pre-Arrival Sync — settings + status.
 *
 *   GET  → current settings, next target date, how many bookings it covers, recent runs.
 *   POST → save { enabled, daysBefore, hour, minute } and re-arm the daily job.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import { getPreSyncStatus, getPreSyncSettings, savePreSyncSettings } from '@/lib/as-prearrival-sync'

export const dynamic = 'force-dynamic'

function guardRole(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:create')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  try {
    return buildApiSuccess(await getPreSyncStatus())
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load sync status', 500)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  let body: { enabled?: boolean; daysBefore?: number; hour?: number; minute?: number }
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const current = await getPreSyncSettings()
  const saved = await savePreSyncSettings({
    enabled:    typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    daysBefore: Number.isFinite(body.daysBefore) ? Number(body.daysBefore) : current.daysBefore,
    hour:       Number.isFinite(body.hour)       ? Number(body.hour)       : current.hour,
    minute:     Number.isFinite(body.minute)     ? Number(body.minute)     : current.minute,
  })

  // Re-arm the in-process job so a changed time takes effect now rather than
  // tomorrow. Best-effort: on serverless there is no long-lived process and the
  // cron route drives the job instead.
  try {
    const { reschedulePreArrivalSync } = await import('@/lib/as-prearrival-scheduler')
    await reschedulePreArrivalSync()
  } catch (err) {
    console.error('[presync settings] reschedule failed:', err instanceof Error ? err.message : err)
  }

  return buildApiSuccess({ settings: saved }, 'Pre-arrival sync settings saved')
}
