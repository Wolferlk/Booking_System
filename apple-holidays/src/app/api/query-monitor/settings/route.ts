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

  for (const field of ['sheetUrl', 'backupSheetUrl'] as const) {
    if (body[field] === undefined) continue
    const url = String(body[field]).trim()
    if (url && !/^https?:\/\//i.test(url)) return buildApiError('Workbook URL must start with https://')
  }

  // A backup that is the same file as the live workbook is not a backup: every
  // row would be appended to it twice, and the two sets of row numbers would
  // collide so later rewrites would land on the wrong rows.
  if (body.sheetUrl !== undefined || body.backupSheetUrl !== undefined) {
    const current = await getConfig()
    const primary = String(body.sheetUrl       ?? current.sheetUrl).trim()
    const backup  = String(body.backupSheetUrl ?? current.backupSheetUrl).trim()
    if (primary && backup && primary === backup) {
      return buildApiError(
        'The backup workbook must be a different file from the live one — '
        + 'the same link is in both boxes.',
      )
    }
  }
  if (body.intervalMinutes !== undefined && Number(body.intervalMinutes) < 5) {
    return buildApiError('Interval must be at least 5 minutes — Graph throttles tighter loops')
  }

  // The two tabs must stay distinct, or excluded mail would be appended to the
  // query sheet in a nine-column layout and wreck it.
  if (body.excludedSheetName !== undefined || body.sheetName !== undefined) {
    const current  = await getConfig()
    const query    = String(body.sheetName ?? current.sheetName).trim().toLowerCase()
    const excluded = String(body.excludedSheetName ?? current.excludedSheetName).trim().toLowerCase()
    if (!excluded) return buildApiError('The other-mail tab needs a name')
    if (query === excluded) {
      return buildApiError('The other-mail tab must be a different tab from the query sheet')
    }
  }

  await saveConfig(body)
  return buildApiSuccess({ config: await getConfig() }, 'Settings saved')
}
