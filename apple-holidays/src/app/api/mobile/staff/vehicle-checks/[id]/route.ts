/** PATCH /api/mobile/staff/vehicle-checks/[id]  { decision: 'APPROVED'|'REJECTED', note? } */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireStaff } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { decideVehicleCheck, viewerCountry } from '@/lib/mobile/ops'

export const dynamic = 'force-dynamic'

export const PATCH = mobileRoute('staff-vc-decide', async (req: NextRequest, { params }: { params: { id: string } }) => {
  const s = await requireStaff(req)
  const body = await readJson<{ decision?: string; note?: string }>(req)
  if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') throw new MobileError('decision must be APPROVED or REJECTED')
  const r = await decideVehicleCheck(params.id, body.decision, body.note?.trim() || null, { name: s.name, country: viewerCountry(s.role, s.country) })
  return buildApiSuccess(r)
})
