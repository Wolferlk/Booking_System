/**
 * Upcoming Arrivals update check — settings + status.
 *
 *   GET  → settings, the arrival window, coverage, recent runs.
 *   POST → save { enabled, autoApply, hour, minute, horizonDays, maxPerRun }
 *          and re-arm the daily job.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import { getUpSyncStatus, getUpSyncSettings, saveUpSyncSettings } from '@/lib/as-upcoming-sync'

export const dynamic = 'force-dynamic'

function canView(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:create')
}

function canChange(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:edit')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!canView(session.user.role)) return buildApiError('Forbidden', 403)
  try {
    return buildApiSuccess(await getUpSyncStatus())
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load status', 500)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!canChange(session.user.role)) return buildApiError('Forbidden', 403)

  let body: Partial<Record<'enabled' | 'autoApply', boolean> & Record<'hour' | 'minute' | 'horizonDays' | 'maxPerRun', number>>
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const cur = await getUpSyncSettings()
  const num = (v: unknown, fallback: number) => (Number.isFinite(v) ? Number(v) : fallback)
  const saved = await saveUpSyncSettings({
    enabled:     typeof body.enabled === 'boolean' ? body.enabled : cur.enabled,
    autoApply:   typeof body.autoApply === 'boolean' ? body.autoApply : cur.autoApply,
    hour:        num(body.hour, cur.hour),
    minute:      num(body.minute, cur.minute),
    horizonDays: num(body.horizonDays, cur.horizonDays),
    maxPerRun:   num(body.maxPerRun, cur.maxPerRun),
  })

  try {
    const { rescheduleUpcomingSync } = await import('@/lib/as-upcoming-scheduler')
    await rescheduleUpcomingSync()
  } catch (err) {
    console.error('[upcoming-sync settings] reschedule failed:', err instanceof Error ? err.message : err)
  }

  return buildApiSuccess({ settings: saved }, 'Upcoming update check settings saved')
}
