/**
 * The browsable D-4 board — everything sold inside four days of arrival around
 * today, whether or not anybody has acknowledged it.
 *
 * The alarm feed (`../route.ts`) answers "what is nobody looking after?", and it
 * empties itself the moment a file is picked up. This answers the other
 * question — "what came in late, and who has it?" — which the desk needs after
 * the shouting stops, so the header icon that opens it is permanent.
 *
 * Read-only. Acknowledging still goes through `POST /api/bookings/last-minute`,
 * so there is exactly one place that writes.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { listLastMinuteBoard, type LastMinuteViewer } from '@/lib/last-minute'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

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
    return buildApiSuccess(await listLastMinuteBoard(viewerFrom(session)))
  } catch (err) {
    // Polled from the header on every dashboard page: a failure here degrades to
    // an empty board rather than taking the chrome down with it.
    console.error('[GET /api/bookings/last-minute/board]', err)
    return buildApiError('Could not load the last-minute board', 500)
  }
}
