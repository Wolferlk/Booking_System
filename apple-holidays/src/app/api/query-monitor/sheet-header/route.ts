/**
 * Query Monitor — the two ways out of a header that no longer matches.
 *
 * The sweep writes rows by position, so a hand-edited row 1 stops it: writing
 * on regardless would file every value under the wrong heading. "Prepare" can
 * only help while the tab is empty. Once there are rows on it, one of these two
 * has to be chosen, and both of them keep every row that is already there:
 *
 *   • `adopt`   — leave the sheet exactly as the team left it and write into the
 *                 columns as they now stand. Nothing on the tab is changed.
 *   • `restore` — put the standard layout back, having first copied the tab to
 *                 an archive tab, and move every row's values into the columns
 *                 the layout expects. Row numbers are kept, so the sweep picks
 *                 up where it left off.
 *
 * Both act on the live workbook and on the backup, when mirroring is on and it
 * is a second file — leaving one of the two on a different layout is what would
 * make the mirror diverge.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { getConfig } from '@/lib/query-monitor/config'
import {
  adoptCustomHeader, resolveSheetRef, restoreStandardHeader,
  type TabHeaderReport, type TabRestoreReport, type WorkbookTarget,
} from '@/lib/query-monitor/sheet'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const body   = await request.json().catch(() => ({})) as { action?: string }
  const action = body.action

  if (action !== 'adopt' && action !== 'restore') {
    return buildApiError('Unknown action — expected "adopt" or "restore"')
  }

  const config = await getConfig()
  if (!config.sheetUrl) return buildApiError('Set the workbook URL first')

  // The same rule the sweep and Prepare use: a backup that resolves to the live
  // file is not a second workbook, and doing the work twice on one file would
  // archive the archive.
  const targets: WorkbookTarget[] = ['primary']
  if (config.backupEnabled) {
    const [primary, backup] = await Promise.all([
      resolveSheetRef(false, 'primary'),
      resolveSheetRef(false, 'backup').catch(() => null),
    ])
    if (backup && !(backup.driveId === primary.driveId && backup.itemId === primary.itemId)) {
      targets.push('backup')
    }
  }

  try {
    if (action === 'adopt') {
      const results = await Promise.all(targets.map(async target => ({
        target, ...await adoptCustomHeader(target),
      })))
      return buildApiSuccess({ action, results }, summarizeAdopt(results.flatMap(r => r.tabs)))
    }

    const results = await Promise.all(targets.map(async target => ({
      target, ...await restoreStandardHeader(target),
    })))
    return buildApiSuccess({ action, results }, summarizeRestore(results.flatMap(r => r.tabs)))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(
      action === 'adopt'
        ? `Could not read the header: ${msg}`
        : `Could not restore the layout: ${msg}`,
      502,
    )
  }
}

function summarizeAdopt(tabs: TabHeaderReport[]): string {
  // A tab that is not there yet, or still blank, is not a failure — only a tab
  // whose header could not be read or matched is.
  const failed = tabs.filter(t => t.error && !t.skipped)
  const done   = tabs.filter(t => !t.error)
  if (done.length === 0) {
    const reasons = (failed.length > 0 ? failed : tabs).map(t => `"${t.tab}": ${t.error}`)
    return `Nothing adopted — ${reasons.join('; ')}`
  }

  const missing = Array.from(new Set(done.flatMap(t => t.missing)))
  return `Writing into your columns as they stand on ${done.map(t => `"${t.tab}"`).join(', ')}`
    + `. Nothing on the sheet was changed`
    + (missing.length > 0 ? `; ${missing.join(', ')} have no column here and are not written` : '')
    + (failed.length > 0 ? `. ${failed.map(t => `"${t.tab}": ${t.error}`).join('; ')}` : '')
}

function summarizeRestore(tabs: TabRestoreReport[]): string {
  const failed   = tabs.filter(t => t.error)
  const restored = tabs.filter(t => !t.error && t.archive)
  const untouched = tabs.filter(t => !t.error && !t.archive)

  if (restored.length === 0 && failed.length === 0) {
    return 'Nothing to restore — both tabs already carry the standard layout'
  }
  if (restored.length === 0) {
    return `Nothing restored — ${failed.map(t => `"${t.tab}": ${t.error}`).join('; ')}`
  }

  const rows    = restored.reduce((n, t) => n + t.rows, 0)
  const dropped = Array.from(new Set(restored.flatMap(t => t.archivedColumns)))
  return `Layout restored on ${restored.map(t => `"${t.tab}"`).join(', ')}`
    + ` — ${rows.toLocaleString()} row(s) moved into the standard columns, everything copied first to `
    + restored.map(t => `"${t.archive}"`).join(', ')
    + (dropped.length > 0 ? `. Your own columns (${dropped.join(', ')}) live on the archive tab now` : '')
    + (untouched.length > 0 ? `. "${untouched.map(t => t.tab).join('", "')}" already matched` : '')
    + (failed.length > 0 ? `. ${failed.map(t => `"${t.tab}": ${t.error}`).join('; ')}` : '')
}
