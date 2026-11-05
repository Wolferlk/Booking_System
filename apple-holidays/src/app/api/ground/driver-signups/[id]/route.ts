/**
 * POST /api/ground/driver-signups/:requestId  { action: 'approve' | 'decline', note? }
 *
 * Approve switches the driver (and the vehicle they registered) on, so they
 * can sign in to the Aahaas app; decline leaves both switched off. Nothing is
 * deleted either way.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import { isInCountryScope } from '@/lib/country-detection'
import { MobileError, isMobileTableMissing } from '@/lib/mobile/http'
import { approveDriverSignup, declineDriverSignup } from '@/lib/mobile/signup'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as { action?: string; note?: string }
  if (body.action !== 'approve' && body.action !== 'decline') return buildApiError('Choose approve or decline')
  const note = typeof body.note === 'string' ? body.note : null

  try {
    const request = await prisma.mobileDriverRequest.findUnique({ where: { id: params.id }, select: { driverId: true } })
    if (!request) return buildApiError('Registration not found', 404)
    const driver = await prisma.driver.findUnique({ where: { id: request.driverId }, select: { country: true } })
    const userCountry = session.user.country as string | undefined
    if (driver?.country && userCountry && userCountry !== 'ALL' && !isInCountryScope(driver.country, userCountry)) {
      return buildApiError('This driver is outside your country', 403)
    }

    const by = { userId: session.user.id, name: session.user.name ?? session.user.email ?? 'Operations' }
    const result = body.action === 'approve'
      ? await approveDriverSignup(params.id, by, note)
      : await declineDriverSignup(params.id, by, note)

    await logActivity({
      userId: session.user.id,
      action: ACTION.DRIVER_UPDATED,
      entityType: 'Driver',
      entityId: result.driverId,
      details: { registration: body.action === 'approve' ? 'approved' : 'declined', ...(note ? { note } : {}) },
    })
    return buildApiSuccess(result, body.action === 'approve' ? 'Driver approved' : 'Registration declined')
  } catch (err) {
    if (err instanceof MobileError) return buildApiError(err.message, err.status)
    if (isMobileTableMissing(err)) return buildApiError('The driver app tables are not on this database yet.', 503)
    console.error('[driver-signups POST]', err)
    return buildApiError('Could not save the decision. Please try again.', 500)
  }
}
