import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getLessCreditModeEnabled, RECENT_MAIL_WINDOW_MINUTES, LESS_CREDIT_MODE_KEY } from '@/lib/mail-mode'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const lessCreditMode = await getLessCreditModeEnabled()
  return buildApiSuccess({
    lessCreditMode,
    recentMailWindowMinutes: RECENT_MAIL_WINDOW_MINUTES,
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as { lessCreditMode?: boolean }
  if (typeof body.lessCreditMode !== 'boolean') {
    return buildApiError('lessCreditMode must be a boolean')
  }

  await prisma.systemSetting.upsert({
    where:  { key: LESS_CREDIT_MODE_KEY },
    create:  { key: LESS_CREDIT_MODE_KEY, value: body.lessCreditMode ? 'true' : 'false' },
    update:  { value: body.lessCreditMode ? 'true' : 'false' },
  })

  return buildApiSuccess({
    lessCreditMode: body.lessCreditMode,
    recentMailWindowMinutes: RECENT_MAIL_WINDOW_MINUTES,
  }, 'Mail mode updated')
}
