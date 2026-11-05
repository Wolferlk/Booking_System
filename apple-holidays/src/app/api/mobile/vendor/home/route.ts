/**
 * GET /api/mobile/vendor/home — the vendor's fleet at a glance: who is driving
 * now, today's trips, what needs a driver, and what to fix in the fleet.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireVendor } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { vendorHome } from '@/lib/mobile/vendor'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('vendor-home', async (req: NextRequest) => buildApiSuccess(await vendorHome(await requireVendor(req))))
