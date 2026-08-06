/** Query Monitor — schedule, sheet target and behaviour switches. */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { getConfig, saveConfig } from '@/lib/query-monitor/config'
import { SETTINGS } from '@/lib/query-monitor/constants'
import { SHEET_TZ } from '@/lib/query-monitor/dates'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const config = await getConfig()
  const lock = await prisma.systemSetting.findUnique({ where: { key: SETTINGS.runLock } })

  const nextRunAt = config.lastRunAt
    ? new Date(new Date(config.lastRunAt).getTime() + config.intervalMinutes * 60_000).toISOString()
    : null

  return buildApiSuccess({
    config,
    timezone:  SHEET_TZ,
    isRunning: !!lock,
    nextRunAt,
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const body = await req.json() as Record<string, unknown>

  if (body.sheetUrl !== undefined) {
    const url = String(body.sheetUrl).trim()
    if (url && !/^https?:\/\//i.test(url)) return buildApiError('Workbook URL must start with https://')
  }
  if (body.intervalMinutes !== undefined && Number(body.intervalMinutes) < 5) {
    return buildApiError('Interval must be at least 5 minutes — Graph throttles tighter loops')
  }

  await saveConfig(body)
  return buildApiSuccess({ config: await getConfig() }, 'Settings saved')
}
