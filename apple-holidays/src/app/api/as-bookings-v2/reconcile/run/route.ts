/**
 * POST /api/as-bookings-v2/reconcile/run — the "Reconcile now" button.
 *
 * Runs one full reconciliation immediately and returns what it found. `force` is
 * set so the button still works while the automatic loop is switched off — it is
 * the manual fallback, not just a way to skip the wait. The KV lock is still
 * respected, so pressing it during an automatic run reports that run rather than
 * starting a second one.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { runAsReconcile, getReconcileStatus } from '@/lib/as-reconcile'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  try {
    const outcome = await runAsReconcile({
      trigger: 'manual',
      triggeredById: session.user.id,
      force: true,
    })

    if (!outcome.ran) {
      return buildApiSuccess(
        { ran: false, reason: outcome.reason, status: await getReconcileStatus() },
        outcome.reason === 'already-running'
          ? 'A reconciliation is already running — showing its progress'
          : 'Reconciliation is disabled',
      )
    }

    const { run } = outcome
    const parts = [
      run.created   ? `${run.created} imported`   : '',
      run.refreshed ? `${run.refreshed} refreshed` : '',
      run.cancelled ? `${run.cancelled} cancelled` : '',
      run.flagged   ? `${run.flagged} flagged`     : '',
    ].filter(Boolean)

    return buildApiSuccess(
      { ran: true, run, status: await getReconcileStatus() },
      run.error
        ? `AppleSystem unreachable — ${run.error}`
        : run.unresolved > 0
          ? `${run.unresolved} confirmation${run.unresolved === 1 ? '' : 's'} still missing — see the run detail`
          : parts.length
            ? `In parity · ${parts.join(', ')}`
            : `In parity — all ${run.upstreamConfirmed} AppleSystem confirmation${run.upstreamConfirmed === 1 ? '' : 's'} are in the system`,
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Reconciliation failed', 500)
  }
}
