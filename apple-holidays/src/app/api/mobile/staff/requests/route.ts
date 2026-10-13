/** GET /api/mobile/staff/requests?status=PENDING|ALL — driver requests + vehicle checks waiting for ops. */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireStaff } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { listRequests, listVehicleChecks, viewerCountry } from '@/lib/mobile/ops'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('staff-requests', async (req: NextRequest) => {
  const s = await requireStaff(req)
  const viewer = { name: s.name, country: viewerCountry(s.role, s.country) }
  const all = req.nextUrl.searchParams.get('status') === 'ALL'
  const [requests, vehicleChecks] = await Promise.all([
    listRequests(viewer, all ? 'ALL' : 'PENDING'),
    listVehicleChecks(viewer, all ? 'ALL' : 'SUBMITTED'),
  ])
  return buildApiSuccess({ requests, vehicleChecks })
})
