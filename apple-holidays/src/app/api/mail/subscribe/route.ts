import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getSubscriptionStatus, autoSubscribe } from '@/lib/mail-processor'

export const dynamic = 'force-dynamic'
// GET — return current subscription status
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)
  return buildApiSuccess(await getSubscriptionStatus())
}

// POST — force a subscription check/renew immediately
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  try {
    await autoSubscribe()
    return buildApiSuccess(await getSubscriptionStatus(), 'Webhook subscription checked and renewed')
  } catch (err: unknown) {
    return buildApiError(err instanceof Error ? err.message : String(err), 500)
  }
}
