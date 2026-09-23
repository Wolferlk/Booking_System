import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { checklistSession } from '@/lib/vn-checklist/access'
import { loadBoard } from '@/lib/vn-checklist/server'

export const dynamic = 'force-dynamic'

const MAX_RANGE_DAYS = 180

/** GET ?from=yyyy-mm-dd&to=yyyy-mm-dd&q=&cancelled=1 — every VN booking arriving in the window, with its sheet. */
export async function GET(req: NextRequest) {
  const auth = await checklistSession()
  if ('error' in auth) return buildApiError(auth.error, auth.status)

  const sp = req.nextUrl.searchParams
  const today = new Date()
  const from = sp.get('from') ? new Date(`${sp.get('from')}T00:00:00Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const to = sp.get('to') ? new Date(`${sp.get('to')}T23:59:59Z`) : new Date(from.getTime() + 60 * 86400000)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return buildApiError('Invalid date range')
  if ((to.getTime() - from.getTime()) / 86400000 > MAX_RANGE_DAYS) return buildApiError(`Pick a window of ${MAX_RANGE_DAYS} days or less`)

  try {
    return buildApiSuccess(await loadBoard({
      from, to,
      q: sp.get('q') ?? undefined,
      includeCancelled: sp.get('cancelled') === '1',
    }))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load the checklist board', 500)
  }
}
