/**
 * Query Monitor — remove duplicate rows from the workbook itself.
 *
 * GET  counts what would go (a dry run, nothing is written).
 * POST deletes them and renumbers the row pointers.
 *
 * The companion of `/api/query-monitor/dedupe`, which folds duplicates the
 * database knows about. This one reads the sheet and removes repeats whether or
 * not an entry claims them — the only thing that clears a row appended twice by
 * a retried sync. See lib/query-monitor/sheet-dedupe.ts.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { sweepSheetDuplicates } from '@/lib/query-monitor/sheet-dedupe'

export const dynamic = 'force-dynamic'

function describe(
  result: Awaited<ReturnType<typeof sweepSheetDuplicates>>,
): string {
  const failures = result.tabs.filter(t => t.error)
  const verb     = result.dryRun ? 'would be removed' : 'removed'

  if (result.removed === 0) {
    const base = `No duplicate rows in ${result.scanned} row(s) on the sheet`
    return failures.length > 0
      ? `${base}. ${failures.length} tab(s) could not be read: ${failures.map(f => `${f.tab} — ${f.error}`).join('; ')}`
      : base
  }

  const perTab = result.tabs
    .filter(t => t.removed > 0)
    .map(t => `${t.removed} on "${t.tab}"${t.target === 'backup' ? ' (backup)' : ''}`)
    .join(', ')

  return `${result.removed} duplicate row(s) ${verb} — ${perTab}`
    + (result.entriesMerged > 0 ? `; ${result.entriesMerged} quer(ies) folded onto the row that stays` : '')
    + (failures.length > 0
      ? `. ${failures.length} tab(s) failed: ${failures.map(f => `${f.tab} — ${f.error}`).join('; ')}`
      : '')
}

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const result = await sweepSheetDuplicates({ dryRun: true })
  return buildApiSuccess(result, describe(result))
}

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const result = await sweepSheetDuplicates()
  return buildApiSuccess(result, describe(result))
}
