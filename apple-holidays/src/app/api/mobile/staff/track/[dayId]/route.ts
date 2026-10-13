/** GET /api/mobile/staff/track/[dayId] — the GPS route of one driver-day. */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriverOps } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { dayTrack } from '@/lib/mobile/ops'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('staff-track', async (req: NextRequest, { params }: { params: { dayId: string } }) => {
  await requireDriverOps(req)
  return buildApiSuccess({ points: await dayTrack(params.dayId) })
})
