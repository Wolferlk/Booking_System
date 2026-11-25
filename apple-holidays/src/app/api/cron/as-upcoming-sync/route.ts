/**
 * Cron endpoint — fires the daily Upcoming Arrivals update check.
 *
 * For serverless (Vercel cron), where there is no always-on process; on the VM
 * the node-cron scheduler in `as-upcoming-scheduler.ts` is the primary path.
 * Both share the `as_upsync_last_run_date` guard and the run lock, so they can
 * never double-fire. Wired to an hourly tick; it waits until the configured
 * time has passed today.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { fireUpSyncOnce, getUpSyncSettings, nowHourMinuteInTz, arrivalWindow } from '@/lib/as-upcoming-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  if (req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  return req.nextUrl.searchParams.get('secret') === cronSecret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const settings = await getUpSyncSettings()
  const { hour, minute } = nowHourMinuteInTz()
  const due = hour > settings.hour || (hour === settings.hour && minute >= settings.minute)
  if (!due) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `before the configured run time (${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')})`,
    })
  }

  const started = await fireUpSyncOnce('cron route')
  return NextResponse.json({
    ok: true,
    started,
    skipped: !started,
    enabled: settings.enabled,
    autoApply: settings.autoApply,
    window: arrivalWindow(settings.horizonDays),
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
