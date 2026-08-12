import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardPrecheck } from '@/lib/precheck-guard'
import { buildPrecheckQueue, summarizeQueue, type Urgency } from '@/lib/hotel-precheck'

export const dynamic = 'force-dynamic'

/** Hard ceiling on the look-ahead window, so one request can never scan a year. */
const MAX_HORIZON_DAYS = 365

function csv(v: string | null): string[] | null {
  if (!v) return null
  const parts = v.split(',').map(s => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : null
}

/**
 * GET /api/precheck/queue — the D-10 Hotel Reconfirmation queue.
 *
 * Read-only: builds the queue from live bookings on every call and writes
 * nothing. A `country` query param may narrow the caller's scope but never
 * widen it.
 */
export async function GET(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard

  const sp = req.nextUrl.searchParams

  // Requested countries are intersected with the caller's own scope.
  const requested = csv(sp.get('country'))
  const countries = session.countries
    ? (requested ? requested.filter(c => session.countries!.includes(c)) : session.countries)
    : requested

  const horizonRaw = Number(sp.get('horizon') ?? 60)
  const horizonDays = Number.isFinite(horizonRaw)
    ? Math.min(Math.max(1, Math.floor(horizonRaw)), MAX_HORIZON_DAYS)
    : 60

  try {
    const rows = await buildPrecheckQueue({
      countries,
      horizonDays,
      search: sp.get('q'),
      statuses: csv(sp.get('status')),
      urgencies: csv(sp.get('urgency')) as Urgency[] | null,
      includePast: sp.get('includePast') === '1',
      includeOwnArrangement: sp.get('includeOwn') === '1',
    })

    return buildApiSuccess({
      rows,
      stats: summarizeQueue(rows),
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[precheck/queue]', e)
    return buildApiError(`Could not build the reconfirmation queue: ${(e as Error).message}`, 500)
  }
}
