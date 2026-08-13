/**
 * Query Monitor — daily mail counts per monitored address.
 *
 * GET  ?days=30 → the counts as JSON, for the dashboard
 * POST ?days=30 → rewrite the workbook's "Daily Mail Stats" tab, charts and all
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { getDailyMailStats } from '@/lib/query-monitor/daily-stats'
import { exportDailyStatsToSheet } from '@/lib/query-monitor/daily-stats-sheet'
import { getConfig } from '@/lib/query-monitor/config'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

async function daysOf(req: Request): Promise<number> {
  const raw = new URL(req.url).searchParams.get('days')
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return Math.min(180, Math.floor(n))
  return (await getConfig()).dailyStatsDays
}

export async function GET(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  try {
    return buildApiSuccess(await getDailyMailStats(await daysOf(req)))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not count the mail', 500)
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  try {
    const result  = await exportDailyStatsToSheet(await daysOf(req))
    const primary = result.workbooks.find(w => w.target === 'primary')
    const backup  = result.workbooks.find(w => w.target === 'backup')
    const t = result.stats.totals

    return buildApiSuccess(
      result,
      `"${result.sheetName}" rewritten — ${primary?.rows ?? 0} rows over ${result.days} days: `
      + `${t.total} mails, ${t.useful} useful, ${t.other} other`
      + (backup?.error ? ` — backup not updated: ${backup.error}` : ''),
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not write the daily counts tab', 502)
  }
}
