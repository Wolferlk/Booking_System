/**
 * Query Monitor — move the collected mail onto a freshly configured workbook.
 *
 * Saving a new workbook URL is only half the move: every entry still remembers
 * the row it owns in the *old* file. This forgets those row numbers so the mail
 * from the start date onwards is appended to the new workbook as if for the
 * first time, and retires the older backlog that belongs to the previous sheet.
 *
 * Nothing is deleted from the old workbook. Deliberately a POST an admin has to
 * press, not something a sweep decides on its own — it rewrites the sync state
 * of every recent entry.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { getConfig } from '@/lib/query-monitor/config'
import { rebaseToNewWorkbook } from '@/lib/query-monitor/run'

export const dynamic = 'force-dynamic'

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const config = await getConfig()
  if (!config.sheetUrl) {
    return buildApiError('Set the workbook URL first, then move the rows onto it')
  }

  const result = await rebaseToNewWorkbook()

  const from = result.startDate || 'the beginning'
  return buildApiSuccess(
    result,
    `${result.requeued} entr${result.requeued === 1 ? 'y' : 'ies'} from ${from} queued for the new workbook`
    + (result.retired > 0 ? `, ${result.retired} older one(s) left on the old sheet` : '')
    + '. Press "Sync to sheet" to write them.',
  )
}
