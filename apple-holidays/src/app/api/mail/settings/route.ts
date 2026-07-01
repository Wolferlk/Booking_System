import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  getLessCreditModeEnabled,
  getMailboxEnabledFlags,
  RECENT_MAIL_WINDOW_MINUTES,
  LESS_CREDIT_MODE_KEY,
  TQ_MAILBOX_ENABLED_KEY,
  PNL_MAILBOX_ENABLED_KEY,
} from '@/lib/mail-mode'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const [lessCreditMode, { tqEnabled, pnlEnabled }] = await Promise.all([
    getLessCreditModeEnabled(),
    getMailboxEnabledFlags(),
  ])

  return buildApiSuccess({
    lessCreditMode,
    tqEnabled,
    pnlEnabled,
    recentMailWindowMinutes: RECENT_MAIL_WINDOW_MINUTES,
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as {
    lessCreditMode?: boolean
    tqEnabled?: boolean
    pnlEnabled?: boolean
  }

  const updates: Promise<unknown>[] = []

  if (typeof body.lessCreditMode === 'boolean') {
    updates.push(prisma.systemSetting.upsert({
      where:  { key: LESS_CREDIT_MODE_KEY },
      create: { key: LESS_CREDIT_MODE_KEY, value: body.lessCreditMode ? 'true' : 'false' },
      update: { value: body.lessCreditMode ? 'true' : 'false' },
    }))
  }

  if (typeof body.tqEnabled === 'boolean') {
    updates.push(prisma.systemSetting.upsert({
      where:  { key: TQ_MAILBOX_ENABLED_KEY },
      create: { key: TQ_MAILBOX_ENABLED_KEY, value: body.tqEnabled ? 'true' : 'false' },
      update: { value: body.tqEnabled ? 'true' : 'false' },
    }))
  }

  if (typeof body.pnlEnabled === 'boolean') {
    updates.push(prisma.systemSetting.upsert({
      where:  { key: PNL_MAILBOX_ENABLED_KEY },
      create: { key: PNL_MAILBOX_ENABLED_KEY, value: body.pnlEnabled ? 'true' : 'false' },
      update: { value: body.pnlEnabled ? 'true' : 'false' },
    }))
  }

  if (updates.length === 0) return buildApiError('No valid settings provided')

  await Promise.all(updates)

  const [lessCreditMode, { tqEnabled, pnlEnabled }] = await Promise.all([
    getLessCreditModeEnabled(),
    getMailboxEnabledFlags(),
  ])

  return buildApiSuccess({
    lessCreditMode,
    tqEnabled,
    pnlEnabled,
    recentMailWindowMinutes: RECENT_MAIL_WINDOW_MINUTES,
  }, 'Settings updated')
}
