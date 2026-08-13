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

  // The four tabs must stay distinct. Two of them are appended to and two are
  // cleared and rewritten whole, so a collision is not a cosmetic problem: it
  // would either lay a nine-column row into the query sheet or wipe it.
  const TAB_FIELDS = [
    ['sheetName',           'the query sheet'],
    ['excludedSheetName',   'the other-mail tab'],
    ['aiUsageSheetName',    'the AI usage tab'],
    ['dailyStatsSheetName', 'the daily mail counts tab'],
  ] as const

  if (TAB_FIELDS.some(([field]) => body[field] !== undefined)) {
    const current = await getConfig()
    const seen = new Map<string, string>()
    for (const [field, label] of TAB_FIELDS) {
      const name = String(body[field] ?? current[field]).trim()
      if (!name) return buildApiError(`${label[0].toUpperCase()}${label.slice(1)} needs a name`)
      const key = name.toLowerCase()
      const clash = seen.get(key)
      if (clash) return buildApiError(`${label} must be a different tab from ${clash}`)
      seen.set(key, label)
    }
  }

  await saveConfig(body)
  return buildApiSuccess({ config: await getConfig() }, 'Settings saved')
}
