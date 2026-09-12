/**
 * The daily report's figure for a window, so the bookings list can print it
 * next to its own and explain the difference.
 *
 * The list counts intake; the report counts the day's AppleSystem
 * confirmations. `created-reconcile.ts` holds the whole argument for why those
 * are two different populations and how they reconcile — this route is only the
 * door to it.
 *
 * `preset=today|yesterday` resolves against the operations timezone rather than
 * the browser's, so the quick filters on the list and the window compared here
 * name the same day.
 *
 * Read-only. It never fails the caller: an unreachable accounts ledger returns
 * `available: false`, which the list renders as "comparison unavailable" rather
 * than as a mismatch.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { reconcileCreated, parseReconcileWindow } from '@/lib/reports/created-reconcile'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  // The comparison is a whole-day, all-countries figure by construction, so it
  // is not shown to a client-scoped session that may not see all of it.
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const window = parseReconcileWindow(req.nextUrl.searchParams)
  if ('error' in window) return buildApiError(window.error, 400)
  const { from, to } = window

  try {
    return buildApiSuccess(await reconcileCreated(from, to))
  } catch (err) {
    console.error('[GET /api/bookings/report-count]', err)
    return buildApiError('Could not compare against the daily report', 500)
  }
}
