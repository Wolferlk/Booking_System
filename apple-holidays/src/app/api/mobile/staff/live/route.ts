/** GET /api/mobile/staff/live — ops view in the app: who is driving, km today, who has not started. */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireStaff } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { liveBoard, viewerCountry } from '@/lib/mobile/ops'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('staff-live', async (req: NextRequest) => {
  const s = await requireStaff(req)
  return buildApiSuccess(await liveBoard({ name: s.name, country: viewerCountry(s.role, s.country) }))
})
