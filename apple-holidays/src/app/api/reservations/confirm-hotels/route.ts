import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import {
  buildHotelMovements, countMovements, parseDateKey, utcDateKey,
  MOVEMENT_FILTERS, type MovementFilter,
} from '@/lib/hotel-movements'

export const dynamic = 'force-dynamic'

function csv(v: string | null): string[] | null {
  if (!v) return null
  const parts = v.split(',').map(s => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : null
}

/**
 * GET /api/reservations/confirm-hotels — the day's hotel movements.
 *
 * Read-only. Every internal role holding `reservation:read` may call it; a
 * `country` param may narrow the caller's own scope but never widen it.
 *
 * Params:
 *   date      yyyy-mm-dd. Omit only together with `q`, which then searches
 *             every date inside a bounded window.
 *   movement  ALL | CHECKIN | CHECKOUT | CONTINUE
 *   country   comma-separated operationCountry values
 *   q         free text (IS number, booking ref, agent, guest, hotel, city)
 *   own       1 to include stays the guest arranged themselves
 */
export async function GET(req: NextRequest) {
  const guard = await guardReservation('reservation:read')
  if (!guard.ok) return guard.response
  const { session } = guard

  const sp = req.nextUrl.searchParams

  // Requested countries are intersected with the caller's scope, never unioned.
  const requested = csv(sp.get('country'))
  const countries = session.countries
    ? (requested ? requested.filter(c => session.countries!.includes(c)) : session.countries)
    : requested

  // An out-of-scope country request must return nothing rather than everything.
  if (session.countries && requested && countries!.length === 0) {
    return buildApiSuccess({
      rows: [], counts: { ALL: 0, CHECKIN: 0, CHECKOUT: 0, CONTINUE: 0 },
      day: sp.get('date'), generatedAt: new Date().toISOString(),
    })
  }

  const search = sp.get('q')
  const dateRaw = sp.get('date')
  const day = parseDateKey(dateRaw)

  if (!day && dateRaw) return buildApiError('`date` must be yyyy-mm-dd', 400)
  if (!day && !search?.trim()) return buildApiError('Provide a `date`, or a `q` to search every date', 400)

  const movementRaw = (sp.get('movement') ?? 'ALL').toUpperCase()
  if (!MOVEMENT_FILTERS.includes(movementRaw as MovementFilter)) {
    return buildApiError(`\`movement\` must be one of ${MOVEMENT_FILTERS.join(', ')}`, 400)
  }

  try {
    // Always built as `ALL` so the counts describe the whole day; the movement
    // filter is applied afterwards. That way the page's four tabs can show
    // real numbers, and switching between them costs no round trip.
    const all = await buildHotelMovements({
      day,
      countries,
      search,
      includeOwnArrangement: sp.get('own') === '1',
    })

    const movement = movementRaw as MovementFilter
    const rows = movement === 'ALL' ? all : all.filter(r => r.movement === movement)

    return buildApiSuccess({
      rows,
      counts: countMovements(all),
      day: day ? utcDateKey(day) : null,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[reservations/confirm-hotels]', e)
    return buildApiError(`Could not build the hotel movement list: ${(e as Error).message}`, 500)
  }
}
