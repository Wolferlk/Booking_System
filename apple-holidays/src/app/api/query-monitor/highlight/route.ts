/**
 * Query Monitor — bring the replied-row colours up to date.
 *
 * A sweep only paints rows it is already writing, so queries answered before the
 * highlight existed sit on the sheet in white. This repaints them. It writes no
 * values at all — only cell fills — and is capped per press, reporting how many
 * rows are still out of step so it can simply be pressed again.
 *
 * POST ?target=primary|backup|both
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { recolourRepliedRows, type RecolourResult } from '@/lib/query-monitor/run'
import { getConfig } from '@/lib/query-monitor/config'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const target = new URL(req.url).searchParams.get('target') ?? 'primary'
  const config = await getConfig()

  try {
    const results: RecolourResult[] = []
    if (target !== 'backup') results.push(await recolourRepliedRows('primary'))
    if ((target === 'backup' || target === 'both') && config.backupEnabled) {
      results.push(await recolourRepliedRows('backup'))
    }

    const primary = results[0]
    const remaining = primary?.remaining ?? 0

    return buildApiSuccess(
      { results, highlightEnabled: config.highlightReplied },
      config.highlightReplied
        ? `${primary?.painted ?? 0} row(s) turned green`
          + ((primary?.cleared ?? 0) > 0 ? `, ${primary?.cleared} cleared` : '')
          + (remaining > 0 ? ` — ${remaining} still to do, press again` : '')
        : `Highlighting is switched off — ${primary?.cleared ?? 0} row(s) had their fill removed`,
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not recolour the rows', 502)
  }
}
