/**
 * The D-4 last-minute booking alert feed.
 *
 * `GET`  — every last-minute booking the caller may see that nobody has
 *          acknowledged yet. Polled by the header alert on every dashboard page,
 *          so it is deliberately cheap: two indexed queries and no joins across
 *          databases.
 * `POST`  — acknowledge one, several, or all of them. Acknowledging is a
 *          team-wide act; see the model note on `BookingLastMinuteAck`.
 *
 * Country scoping and the `CLIENT` carve-out are enforced inside
 * `src/lib/last-minute.ts`, not here, so the feed and the acknowledgement can
 * never disagree about what the caller is allowed to touch.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { acknowledgeLastMinute, listLastMinuteAlerts, type LastMinuteViewer } from '@/lib/last-minute'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** The session's role and country scope, in the shape `lib/last-minute.ts` wants. */
function viewerFrom(session: unknown): LastMinuteViewer {
  const user = (session as { user?: { role?: string; country?: string; countries?: string[] } } | null)?.user
  return {
    role: user?.role as UserRole,
    country: user?.country ?? null,
    countries: user?.countries ?? null,
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  try {
    return buildApiSuccess(await listLastMinuteAlerts(viewerFrom(session)))
  } catch (err) {
    // The header polls this every minute on every page. A failure here must never
    // be able to take the dashboard chrome down, so it degrades to "no alerts".
    console.error('[GET /api/bookings/last-minute]', err)
    return buildApiSuccess({ alerts: [], truncated: false, acksReadable: false, today: '' })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const viewer = viewerFrom(session)
  if (viewer.role === 'CLIENT') return buildApiError('Forbidden', 403)

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const note = typeof body.note === 'string' ? body.note : null

    // `all: true` acknowledges everything currently in the caller's own feed —
    // never a blanket write, so one desk cannot silence another's.
    let refs: string[]
    if (body.all === true) {
      const feed = await listLastMinuteAlerts(viewer)
      refs = feed.alerts.map(a => a.bookingRef)
    } else if (Array.isArray(body.bookingRefs)) {
      refs = body.bookingRefs.map(String)
    } else if (typeof body.bookingRef === 'string') {
      refs = [body.bookingRef]
    } else {
      return buildApiError('bookingRef, bookingRefs or all is required')
    }

    if (refs.length === 0) return buildApiSuccess({ acknowledged: [] }, 'Nothing to acknowledge')

    const user = session.user as { name?: string | null; email?: string | null }
    const result = await acknowledgeLastMinute(refs, { name: user.name, email: user.email }, viewer, note)

    return buildApiSuccess(
      result,
      result.acknowledged.length === 1
        ? `${result.acknowledged[0]} acknowledged`
        : `${result.acknowledged.length} last-minute bookings acknowledged`,
    )
  } catch (err) {
    // Deliberately loud, unlike GET. If the acknowledgement did not save, the
    // operator must be told — otherwise the alarm stops and nobody owns the file.
    console.error('[POST /api/bookings/last-minute]', err)
    const message = err instanceof Error ? err.message : String(err)
    return buildApiError(`Could not save the acknowledgement: ${message}`, 500)
  }
}
