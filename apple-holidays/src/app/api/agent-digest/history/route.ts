/**
 * GET /api/agent-digest/history?from=YYYY-MM-DD&to=YYYY-MM-DD&ruleId=&status=
 * Every delivery (one row per recipient × channel). Defaults to yesterday.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { history, isDigestTableMissing, SETUP_MESSAGE } from '@/lib/agent-digest/server'
import { addDays, todayIn } from '@/lib/agent-digest/shared'

export const dynamic = 'force-dynamic'
const YMD = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const sp = req.nextUrl.searchParams
  const yesterday = addDays(todayIn('Asia/Colombo'), -1)
  const from = YMD.test(sp.get('from') ?? '') ? sp.get('from')! : yesterday
  const to = YMD.test(sp.get('to') ?? '') ? sp.get('to')! : from
  try {
    const rows = await history({ from, to, ruleId: sp.get('ruleId'), status: sp.get('status') })
    return buildApiSuccess({ from, to, rows })
  } catch (err) {
    if (isDigestTableMissing(err)) return buildApiError(SETUP_MESSAGE, 503)
    return buildApiError(err instanceof Error ? err.message : 'Failed', 500)
  }
}
