/**
 * One-click registration of the guest-message template with Meta.
 *
 * `apple_holidays_guest_message` carries the desk's own text to a guest whose
 * 24h window is shut — the mini-chat, "Send now" on a queued message, and the
 * daily plan / feedback invite. See lib/guest-message-template.ts.
 *
 *   GET  — the exact body, examples and current status
 *   POST — submit it for review (UTILITY). A name that already exists comes
 *          back as an error, which is how you tell it was already registered.
 *
 * Admin only: it creates a template on the shared WABA.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaTemplate } from '@/lib/whatsapp'
import {
  TEMPLATE_GUEST_MESSAGE,
  GUEST_MESSAGE_TEMPLATE_LANG,
  GUEST_MESSAGE_BODY,
  GUEST_MESSAGE_EXAMPLES,
  guestTemplateStatus,
  resetGuestTemplateAvailability,
} from '@/lib/guest-message-template'

export const dynamic = 'force-dynamic'

const ADMIN = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ADMIN.includes(session.user.role)) return buildApiError('Forbidden', 403)

  return buildApiSuccess({
    name:     TEMPLATE_GUEST_MESSAGE,
    language: GUEST_MESSAGE_TEMPLATE_LANG,
    category: 'UTILITY',
    body:     GUEST_MESSAGE_BODY,
    examples: GUEST_MESSAGE_EXAMPLES,
    status:   await guestTemplateStatus(),
  })
}

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ADMIN.includes(session.user.role)) return buildApiError('Forbidden', 403)

  try {
    const created = await createMetaTemplate({
      name:         TEMPLATE_GUEST_MESSAGE,
      category:     'UTILITY',
      language:     GUEST_MESSAGE_TEMPLATE_LANG,
      bodyText:     GUEST_MESSAGE_BODY,
      bodyExamples: GUEST_MESSAGE_EXAMPLES,
    })
    resetGuestTemplateAvailability()
    return buildApiSuccess(
      { name: created.name, status: await guestTemplateStatus() },
      `Template "${created.name}" submitted — status ${created.status}`,
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : String(err), 422)
  }
}
