/**
 * Query Monitor — every collected mail, unfiltered.
 *
 * GET  ?days=30 → the ledger as JSON, for the dashboard
 * POST ?days=30 → rewrite the workbook's "All Mails" tab from it
 *
 * The tab is also rewritten at the end of every sweep; this is the by-hand
 * version of the same call, for when somebody wants it now.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { getAllMailsReport } from '@/lib/query-monitor/all-mails'
import { exportAllMailsToSheet } from '@/lib/query-monitor/all-mails-sheet'
import { mailLogStats } from '@/lib/query-monitor/mail-log'
import { getConfig } from '@/lib/query-monitor/config'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

async function daysOf(req: Request): Promise<number | undefined> {
  const raw = new URL(req.url).searchParams.get('days')
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return Math.min(90, Math.floor(n))
  return (await getConfig()).allMailsDays
}

export async function GET(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  try {
    const [report, log] = await Promise.all([
      getAllMailsReport(await daysOf(req)),
      mailLogStats(),
    ])
    return buildApiSuccess({ report, log })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not read the mail log', 500)
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  try {
    const result  = await exportAllMailsToSheet(await daysOf(req))
    const primary = result.workbooks.find(w => w.target === 'primary')
    const backup  = result.workbooks.find(w => w.target === 'backup')
    const t = result.report.totals

    return buildApiSuccess(
      result,
      `"${result.sheetName}" rewritten — ${primary?.rows ?? 0} mail(s) over ${result.days} days: `
      + `${t.queries} queries, ${t.followUps} follow-ups, ${t.other} other, `
      + `${t.internal} internal, ${t.automated} automated`
      + (result.report.truncated > 0
        ? ` — the oldest ${result.report.truncated} did not fit the tab's row ceiling`
        : '')
      + (backup?.error ? ` — backup not updated: ${backup.error}` : ''),
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not write the all-mail tab', 502)
  }
}
