/** Tour vendors + transport vendors (Vietnam) for the compare board's edit box. */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import { searchDirectory } from '@/lib/vn-vendor-sync/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await vendorSyncSession('edit')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  return buildApiSuccess(await searchDirectory(req.nextUrl.searchParams.get('q') ?? ''))
}
