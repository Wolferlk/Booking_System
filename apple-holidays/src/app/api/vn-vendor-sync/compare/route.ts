/** VN Vendor Sync compare board: per movement, the Excel vs the system vs before, and who changed it. */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import { isMissingTable, listCompare, type CompareView } from '@/lib/vn-vendor-sync/server'

export const dynamic = 'force-dynamic'

const VIEWS: CompareView[] = ['attention', 'all', 'applied', 'manual', 'review', 'ignored']

export async function GET(req: NextRequest) {
  const auth = await vendorSyncSession('read')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const sp = req.nextUrl.searchParams
  const view = (VIEWS.includes(sp.get('view') as CompareView) ? sp.get('view') : 'attention') as CompareView
  try {
    const res = await listCompare({
      view, page: Number(sp.get('page')) || 1, pageSize: Number(sp.get('pageSize')) || 30,
      ref: sp.get('ref'), runId: sp.get('runId'), vendor: sp.get('vendor'),
    })
    return buildApiSuccess({ ...res, canEdit: auth.canEdit })
  } catch (err) {
    if (isMissingTable(err)) return buildApiSuccess({ rows: [], total: 0, canEdit: auth.canEdit })
    return buildApiError(err instanceof Error ? err.message : 'Could not load', 500)
  }
}
