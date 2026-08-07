/**
 * Operations day board for `/dashboard/accounts/reports`.
 *
 * Returns who is on the ground on a given date — arrivals, departures and
 * everyone in between — together with the operational checklist for each tour:
 * driver allocation, reconfirmation (client confirm / pre-tour call), tickets
 * and QC1 / QC2.
 *
 * Carries no financial fields by design. The money view lives on the P&L and
 * Profit pages, which are gated separately; this board is for the ops floor.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { collectOpsDay } from '@/lib/reports/ops-day-data'
import type { OperationCountry } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Same role set as the financial report this page replaced. */
const ALLOWED: UserRole[] = ['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ALLOWED.includes(role)) return buildApiError('Forbidden', 403)

  const userCountry = session.user.country as OperationCountry | undefined
  const requested = req.nextUrl.searchParams.get('country')

  // A user locked to one country cannot widen the scope by passing `country`;
  // only roles that already see everything may choose what to look at.
  const country = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? requested
    : (userCountry ?? null)

  try {
    const board = await collectOpsDay({
      // `date` is the single-day shorthand the board itself uses; `from`/`to`
      // is the range the drill-down asks for.
      date: req.nextUrl.searchParams.get('date'),
      from: req.nextUrl.searchParams.get('from'),
      to: req.nextUrl.searchParams.get('to'),
      country,
      search: req.nextUrl.searchParams.get('search'),
    })
    return buildApiSuccess(board)
  } catch (err) {
    console.error('[report/ops] failed', err)
    return buildApiError('Failed to build the operations board', 500)
  }
}
