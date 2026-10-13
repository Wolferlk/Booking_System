/** GET /api/driver-app/requests?status=PENDING|ALL — driver requests + vehicle checks. */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { mobileRoute } from '@/lib/mobile/http'
import { listRequests, listVehicleChecks } from '@/lib/mobile/ops'
import { webViewer } from '../_viewer'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('web-requests', async (req: NextRequest) => {
  const viewer = await webViewer()
  const all = req.nextUrl.searchParams.get('status') === 'ALL'
  const [requests, vehicleChecks] = await Promise.all([
    listRequests(viewer, all ? 'ALL' : 'PENDING'),
    listVehicleChecks(viewer, all ? 'ALL' : 'SUBMITTED'),
  ])
  return buildApiSuccess({ requests, vehicleChecks })
})
