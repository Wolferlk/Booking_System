/**
 * Aahaas B2C amendment notices (order versions — see b2c-amendments.ts).
 *
 *   GET  ?all=1             → notices, newest first (default: old + unacknowledged only)
 *   POST { orderId }        → acknowledge one
 *   PUT  { autoApply }      → switch automatic apply on/off (super admins)
 *
 * Reads/writes only the ops SystemSetting notices; the store is never touched.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { acknowledgeAmendmentNotice, listAmendmentNotices } from '@/lib/b2c-amendments'
import { amendmentAutoApplyOn, setAmendmentAutoApply } from '@/lib/b2c-amendment-sweep'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const all = req.nextUrl.searchParams.get('all') === '1'
  const [notices, autoApply] = await Promise.all([listAmendmentNotices({ openOnly: !all, limit: 100 }), amendmentAutoApplyOn()])
  return buildApiSuccess({ notices, autoApply })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Only a super admin can change this.', 403)

  const body = (await req.json().catch(() => ({}))) as { autoApply?: unknown }
  if (typeof body.autoApply !== 'boolean') return buildApiError('autoApply (true/false) is required', 400)
  await setAmendmentAutoApply(body.autoApply)
  return buildApiSuccess({ autoApply: body.autoApply }, body.autoApply ? 'Store amendments are applied automatically.' : 'Store amendments are only flagged; Update Booking applies them.')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const body = (await req.json().catch(() => ({}))) as { orderId?: unknown }
  const orderId = Number(body.orderId)
  if (!Number.isInteger(orderId) || orderId <= 0) return buildApiError('orderId is required', 400)

  const by = session.user.name || session.user.email || 'staff'
  const notice = await acknowledgeAmendmentNotice(orderId, by)
  if (!notice) return buildApiError(`No amendment notice for order ${orderId}`, 404)
  return buildApiSuccess({ notice }, `Acknowledged by ${by}`)
}
