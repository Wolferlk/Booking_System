/**
 * AI destination for an Aahaas B2C booking.
 *
 *   POST { mode: 'detect' } → read the store order, ask the AI, return the proposal
 *                             (country, destination, city per hotel). Writes nothing.
 *   POST { mode: 'apply' }  → write the proposal detected in the last 30 minutes.
 *
 * Logic lives in `lib/b2c-destination-run.ts`; this route does auth and scoping.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { applyB2cDestination, B2cDestinationError, detectB2cDestination } from '@/lib/b2c-destination-run'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:edit')) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { operationCountry: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  const sessionCountry = session.user.country as OperationCountry | undefined
  // A booking with no country yet is exactly what this fixes, so it stays reachable.
  if (sessionCountry && sessionCountry !== 'ALL' && booking.operationCountry &&
      !isInCountryScope(booking.operationCountry as OperationCountry, sessionCountry)) {
    return buildApiError('Forbidden — this booking belongs to another country.', 403)
  }

  const body = (await req.json().catch(() => ({}))) as { mode?: string }
  try {
    if (body.mode === 'apply') {
      const r = await applyB2cDestination(params.ref, {
        id: session.user.id,
        name: session.user.name || session.user.email || 'Unknown user',
      })
      const hotels = r.hotelsLocked ? ' Hotels are locked — their cities were left as they are.'
        : r.hotelsUpdated ? ` ${r.hotelsUpdated} hotel cit${r.hotelsUpdated === 1 ? 'y' : 'ies'} corrected.` : ''
      return buildApiSuccess(r, `Destination set to ${r.tourDestination ?? '—'}.${hotels}`)
    }
    const proposal = await detectB2cDestination(params.ref)
    return buildApiSuccess(proposal, proposal.ok ? `AI: ${proposal.summary}` : `AI could not decide: ${proposal.reason}`)
  } catch (err) {
    if (err instanceof B2cDestinationError) return buildApiError(err.message, err.status)
    return buildApiError(err instanceof Error ? err.message : 'Destination detection failed', 500)
  }
}
