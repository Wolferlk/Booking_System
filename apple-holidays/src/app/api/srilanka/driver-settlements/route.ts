/**
 * GET /api/srilanka/driver-settlements — the Driver Settlement Register.
 *
 * The Drive Log's own fetch, rearranged into the workbook the desk settles
 * from: the window is read once (`fetchDriveLogRows`), every row is turned into
 * a register line, and the register's filters, sort, grouping and subtotals are
 * applied over the result. Nothing is costed here and nothing is written.
 *
 * Gated on `pnl:read` — the same grant the Drive Log runs on, and for the same
 * reason: every column on this screen is money.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { fetchDriveLogRows } from '@/lib/sl-drive-log-server'
import { savedPackageCosts } from '@/lib/sl-settlement-docs-server'
import {
  applyRegisterFilters, bulkNumbers, groupRegisterRows, parseRegisterQuery,
  registerTotals, sortRegisterRows, toDriveLogQuery, toRegisterRow,
} from '@/lib/sl-settlement-register'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// The accounts reads are MySQL over TLS and their payloads are parsed here.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  // Whether this user may *change* a settlement, as opposed to read one. Sent
  // with the payload so the screen can render itself read-only rather than
  // offering buttons every save would refuse. The write routes check it again.
  const canRecord = hasPermission(role, 'pnl:view_profit')

  const q = parseRegisterQuery(req.nextUrl.searchParams)

  try {
    const result = await fetchDriveLogRows(toDriveLogQuery(q))

    const all = result.rows.map(toRegisterRow)

    /* The package cost the desk typed on the transport settlement sheet, joined
     * on afterwards: it lives in this system's own `sl_settlement_docs` and not
     * in the Drive Log's read, and the register should show the agreed package
     * figure beside the costed one. Read before sorting and filtering so the
     * column can be sorted like any other. A failure here is not worth the
     * screen — the register is a money page that must still open. */
    let packages = new Map<string, number>()
    try {
      packages = await savedPackageCosts(all.map(r => r.bookingRef))
    } catch (err) {
      console.error('[srilanka/driver-settlements] package costs', err)
    }
    for (const row of all) row.packageCost = packages.get(row.bookingRef) ?? null

    const filtered = sortRegisterRows(applyRegisterFilters(all, q), q)

    return buildApiSuccess({
      query: q,
      rows: filtered,
      groups: groupRegisterRows(filtered, q.groupBy),
      totals: registerTotals(filtered),
      /* The unfiltered window, so the screen can say "38 of 212" and offer the
       * bulk numbers that exist rather than only those that survived the
       * filters — a filter whose own options are filtered is a trap. */
      windowTotals: registerTotals(all),
      bulks: bulkNumbers(all),
      advancesAvailable: result.advancesAvailable,
      actualsAvailable:  result.actualsAvailable,
      truncated: result.truncated,
      matched:   result.matched,
      today:     result.today,
      canRecord,
    })
  } catch (err) {
    console.error('[srilanka/driver-settlements]', err)
    return buildApiError('Failed to load the settlement register', 500)
  }
}
