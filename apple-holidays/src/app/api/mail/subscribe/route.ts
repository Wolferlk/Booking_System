import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { ensureWebhookSubscription, getSubscriptionStatus } from '@/lib/mail-processor'

function buildNotificationUrl(): string | null {
  const raw = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? ''
  if (!raw) return null
  // Ensure HTTPS and no trailing slash
  const url = raw.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://')
  if (url.includes('localhost') || url.includes('127.0.0.1')) return null
  return `${url}/api/mail/webhook`
}

// GET — current subscription status
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)
  return buildApiSuccess({ ...getSubscriptionStatus(), notificationUrl: buildNotificationUrl() })
}

// POST — create or renew webhook subscription
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const notificationUrl = buildNotificationUrl()
  if (!notificationUrl) {
    return buildApiError(
      'APP_URL must be a public HTTPS domain (e.g. https://yourapp.vercel.app). ' +
      'For local testing install ngrok → run: ngrok http 3000 → set APP_URL to the https:// ngrok URL.',
      400,
    )
  }

  try {
    await ensureWebhookSubscription(notificationUrl)
    return buildApiSuccess({ notificationUrl, ...getSubscriptionStatus() }, 'Auto-process webhook is active')
  } catch (err: unknown) {
    return buildApiError(err instanceof Error ? err.message : String(err), 500)
  }
}
