/**
 * The count check, opened: every booking behind every number on the panel.
 *
 * The panel's own route (`../route.ts`) returns the four counts. This one
 * returns the rows those counts are made of, bucketed and each carrying the
 * sentence that explains why it is where it is — so "they differ by two" can be
 * answered with "these two" on the screen the question was asked on.
 *
 * Same window parsing as the panel, deliberately shared, so the figure and the
 * rows behind it can never be cut for different days.
 *
 * Read-only. An unreachable accounts ledger comes back `available: false` with
 * the intake rows still filled, exactly as the report itself falls back.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { parseReconcileWindow } from '@/lib/reports/created-reconcile'
import { reconcileCreatedDetail } from '@/lib/reports/created-reconcile-detail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  // A whole-window, all-countries answer by construction — not for a
  // client-scoped session that may not be entitled to all of it.
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const window = parseReconcileWindow(req.nextUrl.searchParams)
  if ('error' in window) return buildApiError(window.error, 400)

  try {
    return buildApiSuccess(await reconcileCreatedDetail(window.from, window.to))
  } catch (err) {
    console.error('[GET /api/bookings/report-count/detail]', err)
    return buildApiError('Could not build the reconciliation', 500)
  }
}
