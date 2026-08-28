/**
 * AppleSystem reconciliation — settings + status.
 *
 *   GET  → settings, last/next run, the rolling window, the per-day parity
 *          ledger and the recent run log.
 *   POST → save { enabled, intervalMinutes, lookbackDays, refreshEnabled,
 *          autoCancelEnabled } and re-arm the loop.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import {
  getReconcileStatus,
  getReconcileSettings,
  saveReconcileSettings,
} from '@/lib/as-reconcile'

export const dynamic = 'force-dynamic'

function guardRole(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:create')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  try {
    return buildApiSuccess(await getReconcileStatus())
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load reconciliation status', 500)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  // Auto-cancel withdraws live bookings. Reading the parity numbers is ordinary
  // ops work, but arming the one destructive action is not — that needs the
  // same authority as cancelling a booking by hand.
  let body: {
    enabled?: boolean
    intervalMinutes?: number
    lookbackDays?: number
    refreshEnabled?: boolean
    autoCancelEnabled?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const current = await getReconcileSettings()

  if (
    typeof body.autoCancelEnabled === 'boolean' &&
    body.autoCancelEnabled !== current.autoCancelEnabled &&
    !hasPermission(session.user.role, 'booking:cancel')
  ) {
    return buildApiError('You do not have permission to change the auto-cancel setting', 403)
  }

  const saved = await saveReconcileSettings({
    enabled:           typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    intervalMinutes:   Number.isFinite(body.intervalMinutes) ? Number(body.intervalMinutes) : current.intervalMinutes,
    lookbackDays:      Number.isFinite(body.lookbackDays)    ? Number(body.lookbackDays)    : current.lookbackDays,
    refreshEnabled:    typeof body.refreshEnabled === 'boolean' ? body.refreshEnabled : current.refreshEnabled,
    autoCancelEnabled: typeof body.autoCancelEnabled === 'boolean' ? body.autoCancelEnabled : current.autoCancelEnabled,
  })

  // Re-arm the in-process loop so a changed interval takes effect now rather
  // than after the pending delay expires. Best-effort: on serverless there is no
  // long-lived process to re-arm and the cron route drives the loop instead.
  try {
    const { rescheduleAsReconcile } = await import('@/lib/as-reconcile-scheduler')
    await rescheduleAsReconcile()
  } catch (err) {
    console.error('[reconcile settings] reschedule failed:', err instanceof Error ? err.message : err)
  }

  return buildApiSuccess({ settings: saved }, 'Reconciliation settings saved')
}
