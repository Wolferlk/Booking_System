/**
 * Query Monitor — workbook connection status and a live tail of the sheet.
 *
 * Lets an admin confirm, before switching auto-write on, that the system is
 * pointed at the right file and tab and that its columns still line up.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { getSheetInfo, listWorksheets, readRows } from '@/lib/query-monitor/sheet'
import { getConfig } from '@/lib/query-monitor/config'
import { SHEET_COLUMNS } from '@/lib/query-monitor/constants'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const force  = req.nextUrl.searchParams.get('refresh') === '1'
  const tail   = Math.min(Number(req.nextUrl.searchParams.get('tail') ?? '8'), 50)
  const target = req.nextUrl.searchParams.get('target') === 'backup' ? 'backup' : 'primary'

  try {
    const info = await getSheetInfo(force, target)

    // The last few rows as they actually sit in Excel — the ground truth check.
    let tailRows: string[][] = []
    if (tail > 0 && info.lastDataRow > 1) {
      const from = Math.max(2, info.lastDataRow - tail + 1)
      tailRows = await readRows(from, info.lastDataRow, { target })
    }

    const worksheets = await listWorksheets(target).catch(() => [])

    // The standby copy's state, alongside the live one, so an admin can see at a
    // glance whether the mirror has fallen behind. Never fatal: a broken backup
    // must not make the live workbook's panel unreadable.
    const config = await getConfig()
    const backup = target === 'primary' && config.backupEnabled
      ? await getSheetInfo(force, 'backup')
          .then(b => ({ ok: true as const, info: b }))
          .catch(err => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
      : null

    return buildApiSuccess({
      info,
      expectedColumns: [...SHEET_COLUMNS],
      tailRows,
      tailFirstRow: Math.max(2, info.lastDataRow - tail + 1),
      worksheets,
      backup,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Could not read the workbook: ${msg}`, 502)
  }
}
