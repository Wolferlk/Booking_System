/**
 * MC Excel Feed — Settings API.
 *
 *   GET                         config, last runs, progress (no Graph call)
 *   PUT   (admins)              change link / tab / start date / countries / interval / on-off
 *   POST  { action: 'check' }   read-only look at the workbook (opens, tab, header)
 *   POST  { action: 'preview' } the full plan, computed and shown — NOTHING is written
 *   POST  { action: 'sync', restoreDeleted? }  (admins) carry the plan out now
 *   POST  { action: 'prepare' } (admins) lay out the tab (or the whole empty workbook)
 *   POST  { action: 'settle', items } (admins) settle Meeting Time / Driver conflicts (keep OPS or Excel)
 *   POST  { action: 'sync', allowBulkWriteBack: true } send a write-back batch over the safety limit
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { hasPermission } from '@/lib/rbac'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { feedLockHeldSince, getFeedConfig, getFeedRuns, getFeedState, saveFeedConfig, settleConflict } from '@/lib/mc-excel-feed/config'
import { checkSheet, currentSheetKey, prepareSheet, runFeedSync, type FeedResult } from '@/lib/mc-excel-feed/sync'
import type { FeedConfig, TwoWayKey } from '@/lib/mc-excel-feed/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function who() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) } as const
  const role = session.user.role as UserRole
  if (role === 'CLIENT' || !hasPermission(role, 'agenda:read')) return { error: buildApiError('Forbidden', 403) } as const
  return { role, admin: ADMIN_ROLES.includes(role), name: session.user.name || session.user.email || null } as const
}

async function snapshot(admin: boolean) {
  const [config, state, runs, lockedSince] = await Promise.all([getFeedConfig(), getFeedState(), getFeedRuns(), feedLockHeldSince()])
  return { config, state, runs, running: Boolean(lockedSince), lockedSince, canAdmin: admin }
}

export async function GET() {
  const u = await who()
  if ('error' in u) return u.error
  return buildApiSuccess(await snapshot(u.admin))
}

export async function PUT(req: NextRequest) {
  const u = await who()
  if ('error' in u) return u.error
  if (!u.admin) return buildApiError('Only admins can change the MC Excel Feed', 403)
  const body = await req.json().catch(() => null) as Partial<FeedConfig> | null
  if (!body) return buildApiError('Nothing to save', 400)
  try {
    const before = await getFeedConfig()
    const after = await saveFeedConfig(body)
    const msg = !before.writeBack && after.writeBack ? 'Excel → OPS switched ON — Meeting Time and Driver edits in the Excel now update the agenda'
      : before.writeBack && !after.writeBack ? 'Excel → OPS switched OFF'
      : !before.enabled && after.enabled ? `Automatic sync switched ON — every ${after.intervalMin} min`
      : before.enabled && !after.enabled ? 'Automatic sync switched OFF'
      : before.bandPair !== after.bandPair && after.bandColors ? 'Booking colours changed — the sheet is recoloured on the next sync' : 'Saved'
    return buildApiSuccess(await snapshot(true), msg)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not save', 400)
  }
}

export async function POST(req: NextRequest) {
  const u = await who()
  if ('error' in u) return u.error
  const body = await req.json().catch(() => ({})) as {
    action?: string; restoreDeleted?: boolean; allowBulkWriteBack?: boolean
    items?: { bookingRef?: string; sheetLineId?: string; field?: string; keep?: string; opsKey?: string; xlKey?: string }[]
  }

  try {
    if (body.action === 'check') return buildApiSuccess({ sheet: await checkSheet() })

    if (body.action === 'preview') {
      const r = await runFeedSync({ trigger: 'PREVIEW', by: u.name })
      if (r.run.status === 'FAILED') return buildApiError(r.run.error ?? 'Preview failed', 502)
      return buildApiSuccess(r)
    }

    if (!u.admin) return buildApiError('Only admins can write to the workbook', 403)

    if (body.action === 'prepare') {
      const r = await prepareSheet(u.name)
      return buildApiSuccess({ prepare: r, sheet: await checkSheet() }, r.mode === 'uploaded' ? 'Workbook set up with the full layout and dropdowns' : 'Sheet prepared')
    }

    if (body.action === 'settle') {
      // Settle Meeting Time / Driver conflicts: nothing is written here — the
      // agreed value moves so the next sync carries the chosen side across.
      const items = (body.items ?? []).slice(0, 500).filter(i =>
        i.bookingRef && i.sheetLineId && (i.field === 'meetingTime' || i.field === 'driver') && (i.keep === 'ops' || i.keep === 'excel')
        && typeof i.opsKey === 'string' && typeof i.xlKey === 'string')
      if (!items.length) return buildApiError('Nothing to settle', 400)
      const sheetKey = await currentSheetKey()
      let settled = 0
      for (const i of items) {
        if (await settleConflict({
          sheetKey, bookingRef: i.bookingRef!, sheetLineId: i.sheetLineId!, field: i.field as TwoWayKey,
          keep: i.keep as 'ops' | 'excel', opsKey: i.opsKey!, xlKey: i.xlKey!,
        })) settled++
      }
      return buildApiSuccess({ settled }, `${settled} conflict(s) settled — they are carried across on the next sync`)
    }

    if (body.action === 'sync') {
      // A first fill of thousands of rows outlives a request: answer after 50 s
      // and let it finish in the background (the card polls the progress).
      const job = runFeedSync({ trigger: 'MANUAL', by: u.name, restoreDeleted: body.restoreDeleted === true, allowBulkWriteBack: body.allowBulkWriteBack === true })
      const r = await Promise.race([job, new Promise<null>(res => setTimeout(() => res(null), 50_000))]) as FeedResult | null
      if (!r) return buildApiSuccess({ ...(await snapshot(true)), background: true }, 'Still writing — the sync continues in the background')
      if (r.run.status === 'FAILED') return buildApiError(r.run.error ?? 'Sync failed', 502)
      if (r.run.status === 'SKIPPED') return buildApiError(r.run.error ?? 'Skipped', 409)
      const c = r.run.counts
      const msg = r.run.status === 'NO_CHANGE' ? 'The workbook already matches OPS'
        : `Synced: +${c?.added ?? 0} rows, ${c?.updatedRows ?? 0} updated, ${c?.markedInactive ?? 0} flagged`
      return buildApiSuccess({ ...(await snapshot(true)), result: r }, msg)
    }

    return buildApiError('Unknown action', 400)
  } catch (err) {
    console.error('[mc-excel-feed POST]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed', 500)
  }
}
