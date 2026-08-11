/**
 * Query Monitor — try the failed writes again.
 *
 * A write that fails leaves the entry FAILED with the Graph error on it, and
 * nothing picks those up afterwards: the sync looks for PENDING and DIRTY only.
 * Once the cause is fixed — the header sorted out, the file unlocked — this is
 * what puts the whole failed backlog back in the queue and writes it.
 *
 * Requeue and write are one press on purpose: a requeue that nobody follows with
 * a sync just moves rows from one stuck state to another.
 *
 * `retryFailedWrites` decides per entry whether it is appended or rewritten in
 * place — an entry that already owns a row goes back as DIRTY, never PENDING, so
 * a retry cannot put a second line under a row that is already there.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { retryFailedWrites, syncEntriesToSheet } from '@/lib/query-monitor/run'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const requeued = await retryFailedWrites()
  const total    = requeued.queued + requeued.rewrites

  if (total === 0) {
    return buildApiSuccess(
      { requeued, sync: null },
      requeued.stale > 0
        ? `Nothing to retry — the ${requeued.stale} remaining failure(s) predate the workbook's start date and are never written to it`
        : 'Nothing to retry — no failed writes',
    )
  }

  const sync = await syncEntriesToSheet()

  if (sync.skipped) {
    return buildApiSuccess(
      { requeued, sync },
      `${total} failed row(s) queued again, but a write is already running — they go in with it. `
      + 'Check the sheet in a moment.',
    )
  }

  const detail = [
    requeued.queued   > 0 ? `${requeued.queued} to append` : '',
    requeued.rewrites > 0 ? `${requeued.rewrites} rewritten in place` : '',
  ].filter(Boolean).join(', ')

  return buildApiSuccess(
    { requeued, sync },
    `Retried ${total} failed row(s) (${detail}) — ${sync.appended} appended, ${sync.updated} updated`
    + (sync.failed > 0
      ? `, ${sync.failed} failed again. Open the Run Log for the reason.`
      : '.')
    + (requeued.stale > 0
      ? ` ${requeued.stale} left alone: they predate the workbook's start date.`
      : ''),
  )
}
