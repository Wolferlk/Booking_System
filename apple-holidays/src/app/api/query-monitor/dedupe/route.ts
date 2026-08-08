/**
 * Query Monitor — fold the duplicate rows already in the workbook onto one row
 * per query.
 *
 * Thread merging stops new duplicates from being written; this cleans up the
 * ones written before it existed. The earliest row of each thread is kept and
 * brought up to date, the later ones are deleted from the sheet and their
 * entries marked MERGED.
 *
 * A POST an admin has to press: it deletes rows from the live workbook and
 * renumbers every row pointer below them.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { mergeDuplicateEntries } from '@/lib/query-monitor/run'

export const dynamic = 'force-dynamic'

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const result = await mergeDuplicateEntries()
  const failures = result.workbooks.filter(w => w.error)

  if (result.merged === 0) {
    return buildApiSuccess(result, `No duplicates found across ${result.scanned} queries`)
  }

  const message =
    `${result.merged} duplicate${result.merged === 1 ? '' : 's'} folded into the query they belong to`
    + (result.rowsRemoved > 0 ? `, ${result.rowsRemoved} row(s) removed from the workbook(s)` : '')
    + (failures.length > 0
      ? `. ${failures.length} tab(s) could not be edited: ${failures.map(f => `${f.tab} — ${f.error}`).join('; ')}`
      : '. Press "Sync to sheet" to write the updated rows.')

  return buildApiSuccess(result, message)
}
