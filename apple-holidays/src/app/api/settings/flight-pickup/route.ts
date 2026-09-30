import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { loadFlightPickupRules } from '@/lib/flight-pickup-rules-server'

export const dynamic = 'force-dynamic'

/**
 * GET — the airport pickup timing rules, readable by any signed-in staff
 * member: the agenda editor uses them for the suggested pickup / meeting time
 * on every airport row. Edited by admins on the Settings page via
 * /api/admin/settings (key `flight_pickup_rules`).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  return buildApiSuccess(await loadFlightPickupRules())
}
