/**
 * WhatsApp customer-automation admin API — powers the "WhatsApp Auto" tab on
 * the AI Call Bot page. GET returns toggle states + config + recent sends;
 * POST flips a toggle or triggers a manual run.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  SETTING_DAILY_BRIEFING,
  SETTING_FEEDBACK_REQUEST,
  TAG_DAILY_BRIEFING,
  TAG_FEEDBACK_REQUEST,
  runCustomerDailyBriefing,
  runCustomerFeedbackRequest,
} from '@/lib/customer-whatsapp-automation'

export const dynamic = 'force-dynamic'
const ALLOWED_ROLES = ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const [settings, recentSends, feedbackCount] = await Promise.all([
    prisma.systemSetting.findMany({
      where: { key: { in: [SETTING_DAILY_BRIEFING, SETTING_FEEDBACK_REQUEST] } },
    }),
    prisma.whatsAppMessage.findMany({
      where: {
        direction: 'outbound',
        OR: [
          { senderName: { startsWith: TAG_DAILY_BRIEFING } },
          { senderName: { startsWith: TAG_FEEDBACK_REQUEST } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, bookingRef: true, phone: true, senderName: true, status: true, createdAt: true, body: true },
    }),
    prisma.guestFeedbackForm.count(),
  ])

  const map: Record<string, string> = {}
  settings.forEach(s => { map[s.key] = s.value })

  return buildApiSuccess({
    briefingEnabled:  map[SETTING_DAILY_BRIEFING]  !== 'false',
    feedbackEnabled:  map[SETTING_FEEDBACK_REQUEST] !== 'false',
    sendHour:         Number(process.env.CUSTOMER_MSG_SEND_HOUR ?? '18'),
    tzOffsetHours:    Number(process.env.CUSTOMER_MSG_TZ_OFFSET_HOURS ?? '7'),
    feedbackCount,
    recentSends: recentSends.map(m => ({
      id:         m.id,
      bookingRef: m.bookingRef,
      phone:      m.phone,
      type:       m.senderName?.startsWith(TAG_FEEDBACK_REQUEST) ? 'feedback' : 'briefing',
      recipient:  m.senderName?.replace(TAG_DAILY_BRIEFING, '').replace(TAG_FEEDBACK_REQUEST, '').trim() ?? '',
      status:     m.status,
      createdAt:  m.createdAt,
      preview:    (m.body ?? '').slice(0, 140),
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => null) as
    | { action: 'toggle'; key: 'briefing' | 'feedback'; enabled: boolean }
    | { action: 'run'; job: 'briefing' | 'feedback' }
    | null
  if (!body) return buildApiError('Invalid request body')

  if (body.action === 'toggle') {
    const key = body.key === 'briefing' ? SETTING_DAILY_BRIEFING : SETTING_FEEDBACK_REQUEST
    await prisma.systemSetting.upsert({
      where:  { key },
      create: { key, value: String(body.enabled) },
      update: { value: String(body.enabled) },
    })
    return buildApiSuccess(null, `${body.key === 'briefing' ? 'Daily briefing' : 'Feedback request'} ${body.enabled ? 'enabled' : 'disabled'}`)
  }

  if (body.action === 'run') {
    const result = body.job === 'briefing'
      ? await runCustomerDailyBriefing()
      : await runCustomerFeedbackRequest()
    return buildApiSuccess(result, `Run complete — sent ${result.sent}, skipped ${result.skipped}${result.errors.length ? `, ${result.errors.length} error(s)` : ''}`)
  }

  return buildApiError('Unknown action')
}
