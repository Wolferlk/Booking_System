/**
 * POST /api/as-bookings-v2/watch/run — the "Fetch now" button.
 *
 * Runs one watch cycle immediately and returns what it found. `force` is set so
 * a manual fetch still works while the automatic watch is switched off — the
 * button is also the manual fallback, not just a way to skip the wait.
 *
 * The rolling-window pre-filter keeps a typical run to a single upstream list
 * call, so this is fast enough to await inline; `maxDuration` covers the rarer
 * case where the sweep does find a batch of new confirmations to import.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { runAsWatch, getWatchStatus } from '@/lib/as-watch'

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
    const outcome = await runAsWatch({
      trigger: 'manual',
      triggeredById: session.user.id,
      force: true,
    })

    if (!outcome.ran) {
      return buildApiSuccess(
        { ran: false, reason: outcome.reason, status: await getWatchStatus() },
        outcome.reason === 'already-running'
          ? 'A check is already running — showing its progress'
          : 'Watch is disabled',
      )
    }

    const { check } = outcome
    return buildApiSuccess(
      { ran: true, check, status: await getWatchStatus() },
      check.error
        ? `AppleSystem unreachable — ${check.error}`
        : check.created > 0
          ? `${check.created} new confirmation${check.created === 1 ? '' : 's'} imported`
          : 'No new confirmations — everything is already in the system',
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Fetch failed', 500)
  }
}
