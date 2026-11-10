/**
 * VN Vendor Sync actions: apply a suggestion, undo a write, ignore / resume a
 * movement, undo a whole run, or run the full sweep now.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import {
  applyLink, applyMany, ignoreLink, isMissingTable, resumeLink, revertLast, runVendorSync, setManualVendor, undoLink, undoRun,
} from '@/lib/vn-vendor-sync/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = await vendorSyncSession('edit')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const body = await req.json().catch(() => ({})) as {
    action?: string; linkId?: string; runId?: string; linkIds?: string[]
    name?: string | null; tourVendorId?: string | null; phone?: string | null; expected?: string | null
  }
  try {
    switch (body.action) {
      case 'apply':
      case 'undo':
      case 'ignore':
      case 'resume': {
        if (!body.linkId) return buildApiError('linkId is required')
        const link = await prisma.vnVendorSyncLink.findUnique({ where: { id: body.linkId }, select: { bookingRef: true } })
        if (!link) return buildApiError('Not found', 404)
        const fn = { apply: applyLink, undo: undoLink, ignore: ignoreLink, resume: resumeLink }[body.action]
        const r = await fn(body.linkId, auth.actor)
        return r.ok ? buildApiSuccess(r) : buildApiError(r.message, 409)
      }
      case 'edit': {
        if (!body.linkId) return buildApiError('linkId is required')
        const r = await setManualVendor(body.linkId, {
          name: body.name ?? null, tourVendorId: body.tourVendorId ?? null, phone: body.phone ?? null,
          ...(body.expected !== undefined ? { expected: body.expected } : {}),
        }, auth.actor)
        return r.ok ? buildApiSuccess(r) : buildApiError(r.message, 409)
      }
      case 'revert': {
        if (!body.linkId) return buildApiError('linkId is required')
        const r = await revertLast(body.linkId, auth.actor)
        return r.ok ? buildApiSuccess(r) : buildApiError(r.message, 409)
      }
      case 'applyMany': {
        const ids = Array.isArray(body.linkIds) ? body.linkIds.filter(x => typeof x === 'string') : []
        if (!ids.length) return buildApiError('linkIds is required')
        const r = await applyMany(ids, auth.actor)
        return buildApiSuccess({ ...r, message: `${r.applied} applied${r.failed.length ? `, ${r.failed.length} skipped` : ''}` })
      }
      case 'undoRun': {
        if (!auth.isAdmin) return buildApiError('Only admins can undo a whole run', 403)
        if (!body.runId) return buildApiError('runId is required')
        return buildApiSuccess(await undoRun(body.runId, auth.actor))
      }
      case 'runAll': {
        // The sweep only ever touches Vietnam bookings, and vendorSyncSession already requires Vietnam scope.
        const run = await runVendorSync({ trigger: 'MANUAL', triggeredBy: auth.actor })
        if (!run) return buildApiError('A sweep is already running — try again in a minute', 409)
        const { changes, ...summary } = run
        return buildApiSuccess({ run: summary, changes })
      }
      default:
        return buildApiError('Unknown action')
    }
  } catch (err) {
    if (isMissingTable(err)) return buildApiError('VN Vendor Sync is not set up on this database yet — run prisma/sql/apply-vn-vendor-sync.sh', 503)
    return buildApiError(err instanceof Error ? err.message : 'Action failed', 500)
  }
}
