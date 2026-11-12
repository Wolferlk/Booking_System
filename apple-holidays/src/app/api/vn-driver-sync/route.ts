/** VN Driver Sync — everything the page shows: settings, sweeps, movements, log, unmatched sheet rows. */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import { driverSyncOverview, kickIfDue } from '@/lib/vn-driver-sync/server'

export const dynamic = 'force-dynamic'

const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? v as T : null)

export async function GET(req: NextRequest) {
  const auth = await vendorSyncSession('read')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const sp = req.nextUrl.searchParams
  try {
    void kickIfDue()
    return buildApiSuccess(await driverSyncOverview({
      canEdit: auth.canEdit, isAdmin: auth.isAdmin,
      status: sp.get('status'), ref: sp.get('ref'), runId: sp.get('runId'), page: Number(sp.get('page')) || 1,
      dateBy: pick(sp.get('dateBy'), ['movement', 'arrival'] as const),
      from: sp.get('from'), to: sp.get('to'), q: sp.get('q'),
      conf: pick(sp.get('conf'), ['HIGH', 'MEDIUM', 'NONE'] as const),
      method: pick(sp.get('method'), ['RULES', 'AI'] as const),
      driver: pick(sp.get('driver'), ['has', 'none'] as const),
      phones: pick(sp.get('phones'), ['yes', 'no'] as const),
      minScore: Math.min(100, Math.max(0, Number(sp.get('minScore')) || 0)),
      sort: pick(sp.get('sort'), ['date', 'scoreDesc', 'scoreAsc', 'ref'] as const),
    }))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load', 500)
  }
}
