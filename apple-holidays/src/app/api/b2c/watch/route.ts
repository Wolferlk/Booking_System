/**
 * Run one B2C live-watch check from the B2C page.
 *
 * The page calls this when its preview shows an order marked "Will import", so
 * the order is imported right away instead of at the next timer tick or the
 * 00:30 nightly run. It does exactly what the automation would do — and runs as
 * the automation user — so any staff member viewing the page may trigger it.
 * Honours the B2C auto-import switch; INSERT-only; the store is only read.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { runB2cWatch } from '@/lib/b2c-watch'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  try {
    const outcome = await runB2cWatch({
      trigger: 'manual',
      triggeredBy: `page · ${session.user.email ?? session.user.name ?? 'staff'}`,
    })
    return outcome.ran
      ? buildApiSuccess({ ran: true, summary: outcome.summary })
      : buildApiSuccess({ ran: false, reason: outcome.reason })
  } catch (err) {
    console.error('[POST /api/b2c/watch]', err)
    return buildApiError(err instanceof Error ? err.message : 'Watch failed', 500)
  }
}
