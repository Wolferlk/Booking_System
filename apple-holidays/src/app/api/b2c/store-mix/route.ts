/**
 * Aahaas store orders for a month, split onto the AahaasFlow boards
 * (B2B Packages · B2B Flights · B2C). Read-only on both databases.
 * Powers the Store order mix card on /dashboard/b2c; the monthly business
 * review prints the same figures from the same collector.
 *
 *   GET ?month=2026-10      (defaults to the current month, Asia/Colombo)
 */
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { dateInTz } from '@/lib/b2c-import'
import { collectStoreOrderMix } from '@/lib/reports/store-order-mix'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

function monthRange(y: number, m: number) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { fromDate: `${y}-${mm}-01`, toDate: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const today = dateInTz(new Date(), TZ)
  const asked = req.nextUrl.searchParams.get('month') ?? today.slice(0, 7)
  const match = /^(\d{4})-(\d{2})$/.exec(asked)
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return buildApiError('month must be YYYY-MM', 400)

  const y = Number(match[1])
  const m = Number(match[2])
  const now = monthRange(y, m)
  const previous = m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1)
  // The current month runs to today, and is compared with the same days of last month.
  const partial = asked === today.slice(0, 7)
  const toDate = partial ? today : now.toDate
  const prevTo = partial
    ? `${previous.fromDate.slice(0, 8)}${String(Math.min(Number(today.slice(8)), Number(previous.toDate.slice(8)))).padStart(2, '0')}`
    : previous.toDate

  try {
    const mix = await collectStoreOrderMix({
      fromDate: now.fromDate, toDate,
      previous: { fromDate: previous.fromDate, toDate: prevTo },
    })
    return buildApiSuccess({ month: asked, partial, previousRange: { fromDate: previous.fromDate, toDate: prevTo }, mix })
  } catch (err) {
    console.error('[GET /api/b2c/store-mix]', err)
    return buildApiError(err instanceof Error ? err.message : 'Store order mix failed', 500)
  }
}
