/**
 * GET /api/ground/driver-signups?country=  — independent drivers who registered
 * (in the Aahaas app or on /register/driver) and are waiting for approval.
 * Shown at the top of /dashboard/ground/drivers.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { OperationCountry } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { countryScope } from '@/lib/country-detection'
import { listDriverSignups } from '@/lib/mobile/signup'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  // Same country rule as /api/ground/drivers: a country user sees only their own.
  const userCountry = session.user.country as OperationCountry | undefined
  const override = req.nextUrl.searchParams.get('country') as OperationCountry | null
  const effective = !userCountry || userCountry === 'ALL' ? override : userCountry

  try {
    return buildApiSuccess(await listDriverSignups(countryScope(effective)))
  } catch (err) {
    console.error('[driver-signups GET]', err)
    return buildApiError('Failed to load registrations', 500)
  }
}
