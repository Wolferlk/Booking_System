/**
 * Excel MC Generate — the VN desk's Movement Chart workbook, for one booking.
 *
 * GET  ?refresh=1  — this booking's rows from the workbook (read-only Graph
 *                    download, cached 3 min; refresh forces a new read) plus the
 *                    baseline the chart was last saved from. Writes nothing.
 * POST { keys }    — after the page has saved the chart from the sheet, remember
 *                    which sheet rows it was built from (one system_settings row).
 *
 * Vietnam bookings only. The agenda itself is never written here.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { OperationCountry, UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasPermission, canSeeAllCountries } from '@/lib/rbac'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { SheetAccessError } from '@/lib/vn-driver-sync/sheet'
import { saveBaseline, setBaselinePaused, sheetPayload } from '@/lib/vn-mc-import/server'
import { runMcAutoUpdate } from '@/lib/vn-mc-import/auto'
import { isMcAdmin } from '@/lib/vn-mc-import/config'
import { logBookingEvent } from '@/lib/booking-logs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Gate = { ok: true; ref: string; actor: string | null; actorId: string; role: UserRole } | { ok: false; res: Response }

async function gate(rawRef: string, permission: 'agenda:read' | 'agenda:create'): Promise<Gate> {
  const session = await getServerSession(authOptions)
  if (!session) return { ok: false, res: buildApiError('Unauthorized', 401) }
  const role = session.user.role as UserRole
  if (!hasPermission(role, permission)) return { ok: false, res: buildApiError('Forbidden', 403) }

  const ref = decodeURIComponent(rawRef).trim().toUpperCase()
  const booking = await prisma.booking.findUnique({ where: { bookingRef: ref }, select: { bookingRef: true, operationCountry: true } })
  if (!booking) return { ok: false, res: buildApiError('Booking not found', 404) }
  const isVn = booking.operationCountry === 'VIETNAM' || (!booking.operationCountry && /^VN/i.test(ref))
  if (!isVn) return { ok: false, res: buildApiError('Excel MC Generate is for Vietnam (VN…) bookings only', 400) }

  const country = session.user.country as OperationCountry | undefined
  const allowed = !country || country === 'VIETNAM' || canSeeAllCountries(role, country)
  if (!allowed) {
    return { ok: false, res: buildApiError('This booking is outside your country', 403) }
  }
  return { ok: true, ref, role, actorId: session.user.id, actor: session.user.name || session.user.email || null }
}

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  const g = await gate(params.ref, 'agenda:read')
  if (!g.ok) return g.res
  try {
    const force = req.nextUrl.searchParams.get('refresh') === '1'
    return buildApiSuccess(await sheetPayload(g.ref, force, g.role))
  } catch (err) {
    if (err instanceof SheetAccessError) return buildApiError(`Could not read the Movement Chart workbook: ${err.message}`, 502)
    console.error('[mc-sheet GET]', err)
    return buildApiError(err instanceof Error ? `Could not read the Movement Chart workbook: ${err.message}` : 'Could not read the workbook', 500)
  }
}

/**
 * { keys, title }   — record the baseline after the chart was saved from the sheet.
 * { pause: boolean } — pause / resume the automatic Excel updates for this booking.
 * { action: 'run' }  — admins: run the automatic update for this booking now.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const g = await gate(params.ref, 'agenda:create')
  if (!g.ok) return g.res
  const body = await req.json().catch(() => null) as { keys?: unknown; title?: unknown; pause?: unknown; action?: unknown } | null

  if (typeof body?.pause === 'boolean') {
    try {
      const b = await setBaselinePaused(g.ref, body.pause)
      if (!b) return buildApiError('This chart was not built from the Excel, so it has no automatic updates to pause', 400)
      await logBookingEvent({
        bookingRef: g.ref, section: 'agenda', action: body.pause ? 'excel_auto_paused' : 'excel_auto_resumed',
        actor: { id: g.actorId, name: g.actor }, source: 'user',
        summary: body.pause ? 'Automatic updates from the Excel paused for this chart' : 'Automatic updates from the Excel resumed for this chart',
      })
      return buildApiSuccess(b)
    } catch (err) {
      console.error('[mc-sheet POST pause]', err)
      return buildApiError('Could not change the automatic update setting', 500)
    }
  }

  if (body?.action === 'run') {
    if (!isMcAdmin(g.role)) return buildApiError('Only admins can run the automatic update by hand', 403)
    const res = await runMcAutoUpdate({ trigger: 'MANUAL', bookingRef: g.ref })
    if (!res) return buildApiError('Another automatic update is running — try again in a minute', 409)
    if (res.status === 'FAILED') return buildApiError(res.error || 'The automatic update failed', 502)
    return buildApiSuccess(res.results[0] ?? { bookingRef: g.ref, fields: 0, created: 0, keptOps: 0, skipped: 'not eligible (no Excel baseline, paused, past or cancelled)' })
  }

  const keys = Array.isArray(body?.keys) ? body!.keys.filter((k): k is string => typeof k === 'string' && /^[0-9a-f]{16}$/.test(k)) : null
  if (!keys) return buildApiError('keys must be a list of sheet row fingerprints', 400)
  if (keys.length > 500) return buildApiError('Too many rows', 400)
  try {
    const title = typeof body?.title === 'string' ? body.title.slice(0, 191) : null
    return buildApiSuccess(await saveBaseline(g.ref, keys, g.actor, title))
  } catch (err) {
    console.error('[mc-sheet POST]', err)
    return buildApiError('Could not record the sheet baseline', 500)
  }
}
