/**
 * GET /api/agent-digest/upcoming?offset=1 — what every active digest will send
 * on that day (default tomorrow). Built live, nothing is saved or sent.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { isDigestTableMissing, SETUP_MESSAGE, upcoming } from '@/lib/agent-digest/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const offset = Math.max(0, Math.min(14, Number(req.nextUrl.searchParams.get('offset') ?? '1') || 0))
  try {
    return buildApiSuccess({ offset, items: await upcoming(offset) })
  } catch (err) {
    if (isDigestTableMissing(err)) return buildApiError(SETUP_MESSAGE, 503)
    return buildApiError(err instanceof Error ? err.message : 'Failed', 500)
  }
}
