/** PATCH /api/driver-app/requests/[id]  { decision, note? } */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { decideRequest } from '@/lib/mobile/ops'
import { webViewer } from '../../_viewer'

export const dynamic = 'force-dynamic'

export const PATCH = mobileRoute('web-request-decide', async (req: NextRequest, { params }: { params: { id: string } }) => {
  const viewer = await webViewer()
  const body = await readJson<{ decision?: string; note?: string }>(req)
  if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') throw new MobileError('decision must be APPROVED or REJECTED')
  return buildApiSuccess(await decideRequest(params.id, body.decision, body.note?.trim() || null, viewer))
})
