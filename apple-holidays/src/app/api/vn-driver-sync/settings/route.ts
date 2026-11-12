/** VN Driver Sync settings — mode, interval, days ahead, AI on/off, sheet link. Admins only. */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import { getDriverSyncConfig, saveDriverSyncConfig } from '@/lib/vn-driver-sync/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await vendorSyncSession('read')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  return buildApiSuccess(await getDriverSyncConfig())
}

export async function POST(req: NextRequest) {
  const auth = await vendorSyncSession('admin')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  try {
    const b = await req.json()
    return buildApiSuccess(await saveDriverSyncConfig({ mode: b.mode, intervalMin: b.intervalMin, daysAhead: b.daysAhead, useAi: b.useAi, fillTime: b.fillTime, fillContact: b.fillContact, sheet: b.sheet }))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not save', 400)
  }
}
