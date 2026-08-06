/**
 * Query Monitor — push the reviewed rows to the workbook on demand.
 *
 * This is the button a review-first team presses: sweeps collect and enrich with
 * auto-write off, someone checks the rows, then this writes them.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { syncEntriesToSheet } from '@/lib/query-monitor/run'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const result = await syncEntriesToSheet()

  if (result.failed > 0 && result.appended === 0 && result.updated === 0) {
    return buildApiError(
      `Nothing was written — ${result.failed} row(s) failed. Open the log for the Graph error.`,
      502,
    )
  }

  return buildApiSuccess(
    result,
    `${result.appended} row(s) appended, ${result.updated} updated`
    + (result.failed ? `, ${result.failed} failed` : ''),
  )
}
