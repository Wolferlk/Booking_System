/**
 * Settings → Create Missing Agendas.
 *
 * GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD — arrivals in the range, how many have no
 *        movement chart, why some can't be built, and the running job's progress.
 * POST   { from, to, password } — start a background job that builds every empty
 *        chart in the range (lib/agenda-backfill.ts). Takes the critical services
 *        password, like the other AI Token Controls: it spends one gpt-4o call
 *        per booking.
 * DELETE — stop the running job. Charts already built stay; the one in flight finishes.
 *
 * Admin only. Writes only empty charts, through the same guarded path as the
 * auto-generate sweep.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  summariseRange, backfillProgress, startBackfill, stopBackfill, backfillKilledByEnv,
  BACKFILL_CONCURRENCY, TOKENS_PER_CHART,
} from '@/lib/agenda-backfill'

export const dynamic = 'force-dynamic'

async function admin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return { error: buildApiError('Forbidden — admin only', 403) }
  return { session }
}

const who = (s: { user: { name?: string | null; email?: string | null } }) => s.user.name || s.user.email || 'admin'

export async function GET(req: NextRequest) {
  const { error } = await admin()
  if (error) return error
  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  try {
    const [summary, job] = await Promise.all([
      from && to ? summariseRange(from, to) : Promise.resolve(null),
      backfillProgress(),
    ])
    return buildApiSuccess({
      summary, ...job,
      disabled: backfillKilledByEnv(),
      concurrency: BACKFILL_CONCURRENCY,
      tokensPerChart: TOKENS_PER_CHART,
    })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not read agendas', 400)
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await admin()
  if (error) return error
  const body = await req.json().catch(() => ({})) as { from?: string; to?: string; password?: string }

  const criticalPassword = process.env.CRITICAL_SERVICES_PASSWORD ?? process.env.CRITICAL_OPS_PASSWORD
  if (!criticalPassword) return buildApiError('Critical services password is not configured on the server', 500)
  if (!body.password || body.password !== criticalPassword) return buildApiError('Incorrect critical services password', 403)

  try {
    const job = await startBackfill(body.from, body.to, who(session!))
    return buildApiSuccess(job, `Building ${job.total} agenda${job.total === 1 ? '' : 's'} in the background`)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not start', 400)
  }
}

export async function DELETE() {
  const { session, error } = await admin()
  if (error) return error
  return buildApiSuccess(await stopBackfill(who(session!)), 'Stopped')
}
