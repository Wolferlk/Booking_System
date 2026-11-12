/** VN Driver Sync — everything the page shows: settings, sweeps, movements, log, unmatched sheet rows. */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import { driverSyncOverview, kickIfDue } from '@/lib/vn-driver-sync/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await vendorSyncSession('read')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const sp = req.nextUrl.searchParams
  try {
    void kickIfDue()
    return buildApiSuccess(await driverSyncOverview({
      canEdit: auth.canEdit, isAdmin: auth.isAdmin,
      status: sp.get('status'), ref: sp.get('ref'), runId: sp.get('runId'), page: Number(sp.get('page')) || 1,
    }))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load', 500)
  }
}
