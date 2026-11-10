/** VN Vendor Sync log: runs, events (filterable), status totals, settings. */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import {
  getVendorSyncConfig, isMissingTable, kickIfDue, linkStatusTotals, listEvents, listRuns,
} from '@/lib/vn-vendor-sync/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await vendorSyncSession('read')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const sp = req.nextUrl.searchParams
  try {
    const [config, runs, events, totals] = await Promise.all([
      getVendorSyncConfig(),
      listRuns(Number(sp.get('runPage')) || 1, 15),
      listEvents({
        page: Number(sp.get('page')) || 1, pageSize: 40,
        action: sp.get('action'), ref: sp.get('ref'), runId: sp.get('runId'),
      }),
      linkStatusTotals(),
    ])
    void kickIfDue()
    return buildApiSuccess({ installed: true, config, canEdit: auth.canEdit, isAdmin: auth.isAdmin, ...runs, ...events, totals })
  } catch (err) {
    if (isMissingTable(err)) return buildApiSuccess({ installed: false, canEdit: auth.canEdit, isAdmin: auth.isAdmin, runs: [], events: [], total: 0, totals: {} })
    return buildApiError(err instanceof Error ? err.message : 'Could not load the log', 500)
  }
}
