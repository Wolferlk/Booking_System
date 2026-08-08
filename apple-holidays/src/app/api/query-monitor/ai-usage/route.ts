/**
 * Query Monitor — OpenAI spend, read for the dashboard and pushed to the sheet.
 *
 * GET  ?scope=qm|all  → hourly / daily / weekly / monthly tokens and USD
 * POST ?scope=qm|all  → rewrite the workbook's "AI Usage" tab, charts and all
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { getAiUsageStats, type UsageScope } from '@/lib/query-monitor/ai-usage'
import { exportAiUsageToSheet } from '@/lib/query-monitor/ai-usage-sheet'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

function scopeOf(req: Request): UsageScope {
  return new URL(req.url).searchParams.get('scope') === 'all' ? 'all' : 'qm'
}

export async function GET(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  try {
    return buildApiSuccess(await getAiUsageStats(scopeOf(req)))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not read AI usage', 500)
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  try {
    const result = await exportAiUsageToSheet(scopeOf(req))

    const primary = result.workbooks.find(w => w.target === 'primary')
    const backup  = result.workbooks.find(w => w.target === 'backup')
    const backupNote = backup?.error ? ` — backup not updated: ${backup.error}` : ''

    return buildApiSuccess(
      result,
      `"${result.sheetName}" rewritten — ${primary?.rows ?? 0} rows, ${primary?.charts ?? 0} charts`
      + backupNote,
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not write the usage tab', 502)
  }
}
