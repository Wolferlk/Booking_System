/**
 * POST /api/driver-auto/assign   { tripKey, partyKey, note? }
 *
 * Staff hand a trip straight to a driver/vendor from the board. Recorded as a
 * claim (so the history reads the same) and committed immediately through the
 * same safe path as an approval.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { commitClaim, DaError } from '@/lib/driver-auto/claims'
import { loadTrip, publicTrip } from '@/lib/driver-auto/open-trips'
import { isDaTableMissing, partnerServes, resolveParty, SETUP_MESSAGE } from '@/lib/driver-auto/server'
import { parsePartyKey } from '@/lib/driver-auto/shared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)

  let body: { tripKey?: string; partyKey?: string; note?: string | null }
  try { body = await req.json() } catch { return buildApiError('Invalid JSON', 400) }

  const pk = parsePartyKey(body.partyKey ?? '')
  if (!pk || !body.tripKey) return buildApiError('tripKey and partyKey are required', 400)

  try {
    const party = await resolveParty(pk.type, pk.id)
    if (!party || !party.isActive) return buildApiError('Driver / vendor not found or inactive', 404)

    const live = await loadTrip(body.tripKey)
    if (!live.open) return buildApiError('This trip is no longer open', 409)
    const trip = live.trip
    if (!staff.countries.includes(trip.country)) return buildApiError('This trip is outside your country scope', 403)
    if (!partnerServes(party.country, trip.country)) return buildApiError(`${party.name} is not registered for this country`, 400)

    const claim = await prisma.driverTripClaim.create({
      data: {
        kind: trip.kind, tripKey: trip.key, bookingId: trip.bookingId, bookingRef: trip.bookingRef,
        agendaItemId: trip.agendaItemId, country: trip.country,
        tripDate: new Date(`${trip.startDate}T00:00:00.000Z`),
        tripEndDate: new Date(`${trip.endDate}T00:00:00.000Z`),
        snapshot: { ...publicTrip(trip), leadGuest: trip.leadGuest ?? null, agent: trip.agent ?? null } as unknown as Prisma.InputJsonValue,
        partyType: party.type, partyId: party.id, partyName: party.name, partyPhone: party.phone,
        status: 'PENDING', driverNote: `Assigned by ${staff.name} from the Driver-Auto board`,
      },
    })
    const view = await commitClaim(claim.id, { userId: staff.userId, name: staff.name }, body.note)
    return buildApiSuccess(view, `${party.name} assigned to ${view.bookingRef}${view.notifyResult ? ` (${view.notifyResult})` : ''}`)
  } catch (err) {
    if (err instanceof DaError) return buildApiError(err.message, err.status)
    if (isDaTableMissing(err)) return buildApiError(SETUP_MESSAGE, 503)
    console.error('[driver-auto assign]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed', 500)
  }
}
