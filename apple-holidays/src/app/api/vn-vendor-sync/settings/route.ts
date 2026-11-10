/** VN Vendor Sync settings — mode (AUTO / SUGGEST / OFF), interval, days ahead. Admins only. */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import { getVendorSyncConfig, saveVendorSyncConfig } from '@/lib/vn-vendor-sync/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await vendorSyncSession('read')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  return buildApiSuccess(await getVendorSyncConfig())
}

export async function POST(req: NextRequest) {
  const auth = await vendorSyncSession('admin')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  try {
    const body = await req.json()
    return buildApiSuccess(await saveVendorSyncConfig({
      mode: body.mode, intervalMin: body.intervalMin, daysAhead: body.daysAhead,
    }))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not save', 400)
  }
}
