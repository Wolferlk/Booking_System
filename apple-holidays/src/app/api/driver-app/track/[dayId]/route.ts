/** GET /api/driver-app/track/[dayId] — GPS route of one driver-day. */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { mobileRoute } from '@/lib/mobile/http'
import { dayTrack } from '@/lib/mobile/ops'
import { webViewer } from '../../_viewer'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('web-track', async (_req: NextRequest, { params }: { params: { dayId: string } }) => {
  await webViewer()
  return buildApiSuccess({ points: await dayTrack(params.dayId) })
})
