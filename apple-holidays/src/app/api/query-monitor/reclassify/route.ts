/**
 * Query Monitor — re-apply the exclusion patterns to mail that is still waiting
 * to be written.
 *
 * Editing the pattern list is only half the job: the backlog collected under the
 * old list should follow it. Anything already in a worksheet is left alone —
 * see `reclassifyUnsyncedEntries`.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { classifySubject, parseExcludePatterns } from '@/lib/query-monitor/classify'
import { getConfig } from '@/lib/query-monitor/config'
import { reclassifyUnsyncedEntries } from '@/lib/query-monitor/run'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

/**
 * Try a subject against the saved patterns — the "would this reach the query
 * sheet?" box in the Configuration tab. Answered by the same code the sweep
 * runs, so the preview can never drift from the behaviour.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const subject = (req.nextUrl.searchParams.get('subject') ?? '').trim()
  if (!subject) return buildApiError('Give a subject to test')

  const config = await getConfig()
  const patterns = config.excludeEnabled ? parseExcludePatterns(config.excludePatterns) : []

  return buildApiSuccess({
    subject,
    ...classifySubject(subject, patterns),
    patternCount: patterns.length,
    sheetName:    config.excludeEnabled ? config.excludedSheetName : config.sheetName,
  })
}

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const result = await reclassifyUnsyncedEntries()

  const moved = result.toExcluded + result.toQuery
  const message = moved === 0
    ? `No change — all ${result.scanned} unwritten mail(s) already match the current patterns`
    : `${result.toExcluded} moved to the other-mail tab, ${result.toQuery} moved back to the query sheet`

  return buildApiSuccess(result, message)
}
