/**
 * POST /api/driver-auto/claims/:id   { action: 'approve' | 'reject', note? }
 *
 * Approve re-checks the trip against the live database, takes the race lock,
 * fills the empty driver slot(s) and messages the driver. It never replaces a
 * driver already on a movement.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { commitClaim, DaError, rejectClaim } from '@/lib/driver-auto/claims'
import { isDaTableMissing, SETUP_MESSAGE } from '@/lib/driver-auto/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)

  let body: { action?: string; note?: string | null }
  try { body = await req.json() } catch { return buildApiError('Invalid JSON', 400) }

  try {
    const claim = await prisma.driverTripClaim.findUnique({ where: { id: params.id }, select: { country: true } })
    if (!claim) return buildApiError('Request not found', 404)
    if (!(staff.countries as string[]).includes(claim.country)) return buildApiError('This request is outside your country scope', 403)

    const actor = { userId: staff.userId, name: staff.name }
    if (body.action === 'approve') {
      const view = await commitClaim(params.id, actor, body.note)
      return buildApiSuccess(view, `Approved — ${view.partyName} is on ${view.bookingRef}${view.notifyResult ? ` (${view.notifyResult})` : ''}`)
    }
    if (body.action === 'reject') {
      const view = await rejectClaim(params.id, actor, body.note)
      return buildApiSuccess(view, 'Request declined')
    }
    return buildApiError('action must be approve or reject', 400)
  } catch (err) {
    if (err instanceof DaError) return buildApiError(err.message, err.status)
    if (isDaTableMissing(err)) return buildApiError(SETUP_MESSAGE, 503)
    console.error('[driver-auto claim POST]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed', 500)
  }
}
