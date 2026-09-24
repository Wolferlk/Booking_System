/**
 * Checklist VN 2.1v board — every mirrored tour, filtered and paged, with
 * totals for the current filter. `?tour=CODE` returns that tour's lines.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { checklistSession } from '@/lib/vn-checklist/access'
import { boardTours, linesForTour, type BoardQuery } from '@/lib/vn-checklist-sheet/read'
import { isMissingTable, lastGoodSyncAt, lastSync, refreshIfStale } from '@/lib/vn-checklist-sheet/sync'
import { SHEET_NOT_INSTALLED } from '@/lib/vn-checklist-sheet/shared'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await checklistSession(false)
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const sp = req.nextUrl.searchParams

  try {
    const tour = sp.get('tour')
    if (tour) return buildApiSuccess({ lines: await linesForTour(tour) })

    const query: BoardQuery = {
      q: sp.get('q') ?? undefined,
      month: sp.get('month') ?? undefined,
      agent: sp.get('agent') ?? undefined,
      status: (sp.get('status') as BoardQuery['status']) ?? 'all',
      includeRemoved: sp.get('removed') === '1',
      sort: (sp.get('sort') as BoardQuery['sort']) ?? 'arrival',
      page: Number(sp.get('page') ?? 1),
      pageSize: Number(sp.get('pageSize') ?? 50),
    }
    const [board, sync, good] = await Promise.all([boardTours(query), lastSync(), lastGoodSyncAt()])
    const refreshing = await refreshIfStale()
    return buildApiSuccess({ ...board, lastSync: sync, lastSuccessAt: good?.toISOString() ?? null, refreshing, installed: true })
  } catch (err) {
    if (isMissingTable(err)) return buildApiSuccess({ installed: false, message: SHEET_NOT_INSTALLED })
    return buildApiError(err instanceof Error ? err.message : 'Could not load the board', 500)
  }
}
