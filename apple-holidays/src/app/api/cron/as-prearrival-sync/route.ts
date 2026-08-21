/**
 * Cron endpoint — fires the daily pre-arrival AppleSystem sync.
 *
 * Refreshes every booking arriving in `as_presync_days_before` days (default 3)
 * from AppleSystem. Used on serverless (Vercel cron) where there is no always-on
 * process; on the VM the node-cron scheduler in `as-prearrival-scheduler.ts` is
 * the primary path. Both share the `as_presync_last_run_date` guard and the run
 * lock, so they can never double-fire.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  firePreSyncOnce,
  getPreSyncSettings,
  dateInTzPlus,
  nowHourMinuteInTz,
} from '@/lib/as-prearrival-sync'

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

  const settings = await getPreSyncSettings()

  // This route is wired to an hourly cron, but the job is a daily one whose hour
  // is a user setting. Hold off until the configured time has passed today; the
  // once-a-day guard inside firePreSyncOnce then makes exactly one of the
  // remaining ticks do the work.
  const { hour, minute } = nowHourMinuteInTz()
  const due = hour > settings.hour || (hour === settings.hour && minute >= settings.minute)
  if (!due) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `before the configured run time (${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')})`,
    })
  }

  const started = await firePreSyncOnce('cron route')

  return NextResponse.json({
    ok: true,
    started,
    skipped: !started,
    enabled: settings.enabled,
    daysBefore: settings.daysBefore,
    targetDate: dateInTzPlus(settings.daysBefore),
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
