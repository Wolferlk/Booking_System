/**
 * VN Driver Sync actions: runAll / runBooking (sync now), apply, ignore,
 * restore, undo (one movement), undoRun (admins). All need movement-chart edit rights.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import { applyLink, ignoreLink, restoreLink, runDriverSync, undoLink, undoRun } from '@/lib/vn-driver-sync/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { action?: string; linkId?: string; runId?: string; bookingRef?: string }
  const auth = await vendorSyncSession(body.action === 'undoRun' ? 'admin' : 'edit')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  try {
    switch (body.action) {
      case 'runAll':
      case 'runBooking': {
        const run = await runDriverSync({ trigger: 'MANUAL', triggeredBy: auth.actor, bookingRef: body.action === 'runBooking' ? body.bookingRef : null })
        if (!run) return buildApiError('A sweep is already running — try again in a minute', 409)
        if (run.status === 'FAILED') return buildApiError(run.error ?? 'Sync failed', 502)
        return buildApiSuccess({ run })
      }
      case 'apply':   return buildApiSuccess({ message: await applyLink(String(body.linkId), auth.actor) })
      case 'ignore':  return buildApiSuccess({ message: await ignoreLink(String(body.linkId), auth.actor) })
      case 'restore': return buildApiSuccess({ message: await restoreLink(String(body.linkId), auth.actor) })
      case 'undo':    return buildApiSuccess({ message: await undoLink(String(body.linkId), auth.actor) })
      case 'undoRun': return buildApiSuccess({ message: await undoRun(String(body.runId), auth.actor) })
      default:        return buildApiError('Unknown action', 400)
    }
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Failed', 400)
  }
}
