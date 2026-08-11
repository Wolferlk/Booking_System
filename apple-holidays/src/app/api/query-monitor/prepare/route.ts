/**
 * Query Monitor — lay out the workbooks so they can receive rows.
 *
 * Creates the query tab and the other-mail tab if missing, and writes the
 * expected header on each. This is what fixes a "Column mismatch" on a file
 * copied from the old 13-column sheet, which has no TO List column.
 *
 * It will not rewrite a header that sits above real data: relabelling columns
 * without moving the values under them would silently change what every cell
 * means. Those tabs come back flagged, for a human to sort out.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { getConfig } from '@/lib/query-monitor/config'
import { prepareWorkbook, resolveSheetRef } from '@/lib/query-monitor/sheet'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const config = await getConfig()

  try {
    const primary = await prepareWorkbook('primary')

    // The backup only counts if it is a different file — see the same check in
    // the sweep. Preparing "both" when both links point at one workbook would
    // just report the same file twice and imply a mirror that is not there.
    let backup: Awaited<ReturnType<typeof prepareWorkbook>> | null = null
    let sameFile = false

    if (config.backupEnabled) {
      const [p, b] = await Promise.all([
        resolveSheetRef(false, 'primary'),
        resolveSheetRef(false, 'backup').catch(() => null),
      ])
      sameFile = !!b && b.driveId === p.driveId && b.itemId === p.itemId
      if (b && !sameFile) backup = await prepareWorkbook('backup')
    }

    const blocked = [...primary.tabs, ...(backup?.tabs ?? [])].filter(t => t.headerMismatch)
    const written = [...primary.tabs, ...(backup?.tabs ?? [])].filter(t => t.headerWritten || t.created)

    if (blocked.length > 0) {
      return buildApiError(
        `${blocked.map(t => `"${t.name}"`).join(' and ')} already hold rows under a different header. `
        + 'Nothing was changed. Use "Keep this header" to write into the columns as they stand, or '
        + '"Restore standard layout" to put the layout back with every row copied to an archive tab first.',
        409,
      )
    }

    return buildApiSuccess(
      { primary, backup, sameFile },
      written.length > 0
        ? `Ready — header written on ${written.map(t => `"${t.name}"`).join(', ')}`
        : 'Ready — both tabs already have the expected header'
        + (sameFile ? '. Backup skipped: its link points at the live workbook.' : ''),
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Could not prepare the workbook: ${msg}`, 502)
  }
}
