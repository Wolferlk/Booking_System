/**
 * GET /api/mobile/vendor/trips?scope=upcoming|past
 *
 * Trips ops (or Driver-Auto) gave this vendor: a whole Sri Lanka tour as one
 * job, a single movement elsewhere — with the driver and vehicle on it and
 * whether that driver is on the road right now. Never carries a rate.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireVendor } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { addDaysYmd, localTodayFor } from '@/lib/mobile/trips'
import { vendorJobs } from '@/lib/mobile/vendor'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('vendor-trips', async (req: NextRequest) => {
  const v = await requireVendor(req)
  const today = localTodayFor(v.country)
  const past = req.nextUrl.searchParams.get('scope') === 'past'
  const jobs = past
    ? (await vendorJobs(v, addDaysYmd(today, -60), today)).filter(j => j.state === 'DONE').reverse()
    : (await vendorJobs(v, addDaysYmd(today, -45), addDaysYmd(today, 120))).filter(j => j.state !== 'DONE')
  return buildApiSuccess({ today, jobs })
})
