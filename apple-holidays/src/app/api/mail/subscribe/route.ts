import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { ensureWebhookSubscription, getSubscriptionStatus } from '@/lib/mail-processor'

// GET — current subscription status
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)
  return buildApiSuccess(getSubscriptionStatus())
}

// POST — create or renew webhook subscription
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const appUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? ''
  if (!appUrl || appUrl.includes('localhost')) {
    return buildApiError(
      'Webhooks require a public HTTPS URL. Update APP_URL in .env to your deployed domain (e.g. https://yourapp.vercel.app). For local testing, use ngrok to expose localhost.',
      400,
    )
  }

  const notificationUrl = `${appUrl}/api/mail/webhook`
  try {
    await ensureWebhookSubscription(notificationUrl)
    return buildApiSuccess({ notificationUrl, ...getSubscriptionStatus() }, 'Auto-process webhook is active')
  } catch (err: unknown) {
    return buildApiError(err instanceof Error ? err.message : String(err), 500)
  }
}
