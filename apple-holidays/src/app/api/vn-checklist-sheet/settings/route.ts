/**
 * Checklist VN 2.1v — Settings.
 *
 *   GET   the link, tabs, interval, the last runs and the mirror's size
 *   PUT   change link / tabs / interval / on-off (admins) — then re-reads the file
 *   POST  { action: 'sync', force? } — sync now (anyone who can view the checklist;
 *         it only reads the workbook)
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { checklistSession } from '@/lib/vn-checklist/access'
import {
  getSheetConfig, isMissingTable, lastGoodSyncAt, resolveSheetFile, runSheetSync, saveSheetConfig, toSyncInfo,
} from '@/lib/vn-checklist-sheet/sync'
import { DEFAULT_CHECKLIST_SHEET_URL, SHEET_NOT_INSTALLED } from '@/lib/vn-checklist-sheet/shared'

export const dynamic = 'force-dynamic'
// A first sync writes ~3,800 tours and ~30,000 lines.
export const maxDuration = 300

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function snapshot() {
  const config = await getSheetConfig()
  let installed = true
  let runs: ReturnType<typeof toSyncInfo>[] = []
  let counts = { tours: 0, active: 0, lines: 0 }
  let lastGood: Date | null = null
  try {
    const [rows, tours, active, lines, good] = await Promise.all([
      prisma.vnSheetSync.findMany({ orderBy: { startedAt: 'desc' }, take: 12 }),
      prisma.vnSheetTour.count(),
      prisma.vnSheetTour.count({ where: { isActive: true } }),
      prisma.vnSheetLine.count(),
      lastGoodSyncAt(),
    ])
    runs = rows.map(toSyncInfo)
    counts = { tours, active, lines }
    lastGood = good
  } catch (err) {
    if (!isMissingTable(err)) throw err
    installed = false
  }
  return {
    config: { ...config, isDefaultUrl: config.sheetUrl === DEFAULT_CHECKLIST_SHEET_URL },
    installed, runs, counts,
    lastSuccessAt: lastGood?.toISOString() ?? null,
    nextDueAt: lastGood && config.enabled ? new Date(lastGood.getTime() + config.intervalHours * 3_600_000).toISOString() : null,
  }
}

export async function GET() {
  const auth = await checklistSession(false)
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  try {
    const snap = await snapshot()
    const canAdmin = ADMIN_ROLES.includes(auth.session.user.role as string)
    // The file's current name and web link, for the "Open in Excel" button.
    let file: { fileName: string; webUrl: string; modifiedAt: string | null } | null = null
    try {
      const f = await resolveSheetFile(snap.config.sheetUrl)
      file = { fileName: f.fileName, webUrl: f.webUrl, modifiedAt: f.modifiedAt }
    } catch { /* shown as "could not reach the file" */ }
    return buildApiSuccess({ ...snap, file, canAdmin })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load settings', 500)
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ADMIN_ROLES.includes(session.user.role as string)) return buildApiError('Only admins can change the checklist link', 403)
  const body = await req.json().catch(() => ({})) as {
    sheetUrl?: string; tabs?: string; enabled?: boolean; intervalHours?: number
  }
  try {
    const before = await getSheetConfig()
    const after = await saveSheetConfig(body)
    const sourceChanged = after.sheetUrl !== before.sheetUrl || after.tabs.join() !== before.tabs.join()
    if (sourceChanged) {
      // Check the new link reaches a file before reporting success, then re-read it.
      await resolveSheetFile(after.sheetUrl)
      void runSheetSync({ trigger: 'SETTINGS', force: true, triggeredBy: session.user.name ?? session.user.email })
        .catch(() => { /* recorded on the run row */ })
    }
    return buildApiSuccess(await snapshot(), sourceChanged ? 'Saved — re-reading the workbook now' : 'Saved')
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not save', 400)
  }
}

export async function POST(req: NextRequest) {
  const auth = await checklistSession(false)
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const { action, force } = await req.json().catch(() => ({})) as { action?: string; force?: boolean }
  if (action !== 'sync') return buildApiError('Unknown action', 400)
  const admin = ADMIN_ROLES.includes(auth.session.user.role as string)
  try {
    const res = await runSheetSync({
      trigger: 'MANUAL',
      force: Boolean(force) && admin,
      triggeredBy: auth.session.user.name ?? auth.session.user.email,
    })
    if (!res) return buildApiSuccess(await snapshot(), 'A sync is already running — it will finish on its own')
    if (res.status === 'FAILED') return buildApiError(`Sync failed: ${res.error}`, 502)
    const msg = res.status === 'UNCHANGED'
      ? 'The workbook has not changed since the last sync'
      : `Synced ${res.tours.toLocaleString()} tours — ${res.added} new, ${res.changed} changed, ${res.removed} removed`
    return buildApiSuccess(await snapshot(), msg)
  } catch (err) {
    if (isMissingTable(err)) return buildApiError(SHEET_NOT_INSTALLED, 503)
    return buildApiError(err instanceof Error ? err.message : 'Sync failed', 502)
  }
}
