import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  getAsImportSettings,
  saveAsImportSettings,
  getLastJob,
  SETTING_LAST_RUN_DATE,
} from '@/lib/as-import'

export const dynamic = 'force-dynamic'

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

function guardRole(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:create')
}

/** GET — current auto-import settings + last run summary. */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  const [settings, lastJob, lastRunRow] = await Promise.all([
    getAsImportSettings(),
    getLastJob('auto'),
    prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } }),
  ])

  return buildApiSuccess({
    settings,
    timezone: TZ,
    lastRunDate: lastRunRow?.value ?? null,
    lastJob,
  })
}

/** POST — save { enabled, hour, minute } and re-arm the node-cron schedule. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  let body: { enabled?: boolean; hour?: number; minute?: number }
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const current = await getAsImportSettings()
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled
  const hour = Number.isFinite(body.hour) ? Math.min(23, Math.max(0, Math.trunc(body.hour as number))) : current.hour
  const minute = Number.isFinite(body.minute) ? Math.min(59, Math.max(0, Math.trunc(body.minute as number))) : current.minute

  await saveAsImportSettings({ enabled, hour, minute })

  // Re-arm the in-process node-cron task so a time change takes effect immediately
  // (no-op / best-effort on serverless where there is no long-lived process).
  try {
    const { rescheduleAsImportScheduler } = await import('@/lib/as-import-scheduler')
    await rescheduleAsImportScheduler()
  } catch (err) {
    console.error('[auto-import settings] reschedule failed:', err instanceof Error ? err.message : err)
  }

  return buildApiSuccess({ settings: { enabled, hour, minute } }, 'Settings saved')
}
