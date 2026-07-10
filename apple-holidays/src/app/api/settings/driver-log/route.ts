import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  clampPct,
  SETTING_TOUR_PCT, SETTING_FUEL_PCT, SETTING_AUTO_SEND,
  DEFAULT_TOUR_PCT, DEFAULT_FUEL_PCT,
} from '@/lib/driver-log'

export const dynamic = 'force-dynamic'

/**
 * GET — read-only Driver Log global settings any authenticated staff member can
 * check: the tour/fuel advance percentages and whether the daily 6pm auto-send
 * to drivers is enabled. The values themselves are edited by admins on the
 * Settings page via /api/admin/settings.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_TOUR_PCT, SETTING_FUEL_PCT, SETTING_AUTO_SEND] } },
  })
  const map = new Map(rows.map(r => [r.key, r.value]))
  const parsePct = (v: string | undefined, dflt: number) => {
    const n = v == null ? NaN : parseFloat(v)
    return Number.isFinite(n) ? clampPct(n) : dflt
  }

  return buildApiSuccess({
    tourPct:  parsePct(map.get(SETTING_TOUR_PCT), DEFAULT_TOUR_PCT),
    fuelPct:  parsePct(map.get(SETTING_FUEL_PCT), DEFAULT_FUEL_PCT),
    autoSend: map.get(SETTING_AUTO_SEND) === 'true',
  })
}
