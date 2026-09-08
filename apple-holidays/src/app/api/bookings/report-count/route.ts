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
import { opsToday } from '@/lib/booking-date-window'
import { shiftDate } from '@/lib/reports/report-window'
import { reconcileCreated } from '@/lib/reports/created-reconcile'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A month is already far wider than anything anybody reconciles by eye. */
const MAX_SPAN_DAYS = 31

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  // The comparison is a whole-day, all-countries figure by construction, so it
  // is not shown to a client-scoped session that may not see all of it.
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const { searchParams } = req.nextUrl
  const preset = searchParams.get('preset')

  let from: string
  let to: string

  if (preset === 'today' || preset === 'yesterday') {
    from = to = preset === 'today' ? opsToday() : shiftDate(opsToday(), -1)
  } else {
    const rawFrom = searchParams.get('from')
    const rawTo   = searchParams.get('to')
    if (!rawFrom || !rawTo || !DATE_RE.test(rawFrom) || !DATE_RE.test(rawTo)) {
      return buildApiError('A from and to date are required (yyyy-mm-dd)', 400)
    }
    from = rawFrom <= rawTo ? rawFrom : rawTo
    to   = rawFrom <= rawTo ? rawTo   : rawFrom
  }

  let span = 1
  for (let d = from; d < to; d = shiftDate(d, 1)) {
    if (++span > MAX_SPAN_DAYS) {
      return buildApiError(`That range is wider than ${MAX_SPAN_DAYS} days — narrow it to compare against the report`, 400)
    }
  }

  try {
    return buildApiSuccess(await reconcileCreated(from, to))
  } catch (err) {
    console.error('[GET /api/bookings/report-count]', err)
    return buildApiError('Could not compare against the daily report', 500)
  }
}
