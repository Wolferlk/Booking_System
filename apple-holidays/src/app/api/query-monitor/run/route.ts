/**
 * Query Monitor — "Run now".
 *
 * Runs the same sweep the scheduler does, but forced, so an admin can test the
 * setup while the master switch is still off.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { runQueryMonitorSweep } from '@/lib/query-monitor/run'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as { lookbackHours?: number }
  const lookbackHours = body.lookbackHours && body.lookbackHours > 0
    ? Math.min(body.lookbackHours, 24 * 30)
    : undefined

  const summary = await runQueryMonitorSweep({
    trigger:       'MANUAL',
    triggeredBy:   guard.email ?? guard.name ?? 'admin',
    force:         true,
    lookbackHours,
  })

  if (summary.status === 'SKIPPED') return buildApiError(summary.skipped ?? 'Sweep skipped', 409)

  return buildApiSuccess(summary, `Sweep ${summary.status.toLowerCase()} — ${summary.entriesCreated} new quer${summary.entriesCreated === 1 ? 'y' : 'ies'}`)
}
