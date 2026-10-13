/** PATCH /api/driver-app/vehicle-checks/[id]  { decision, note? } */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { decideVehicleCheck } from '@/lib/mobile/ops'
import { webViewer } from '../../_viewer'

export const dynamic = 'force-dynamic'

export const PATCH = mobileRoute('web-vc-decide', async (req: NextRequest, { params }: { params: { id: string } }) => {
  const viewer = await webViewer()
  const body = await readJson<{ decision?: string; note?: string }>(req)
  if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') throw new MobileError('decision must be APPROVED or REJECTED')
  return buildApiSuccess(await decideVehicleCheck(params.id, body.decision, body.note?.trim() || null, viewer))
})
