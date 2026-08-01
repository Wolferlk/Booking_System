/**
 * Cron endpoint — fires any auto-report whose send time has arrived.
 *
 * The serverless counterpart to `report-scheduler.ts`. Send times are
 * user-configured, so this route runs frequently and lets `runDueSchedules()`
 * decide; Vercel's cron granularity puts a worst-case delay of one tick between
 * the configured minute and the actual send, which is acceptable for a report.
 *
 * Safe to run alongside the in-process scheduler — both claim a slot before
 * building anything, so only one of them can send a given report.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runDueSchedules } from '@/lib/reports/report-runner'
import { runDueCallReport } from '@/lib/te/call-report-schedule'

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

  // The AI call report rides on this tick rather than its own cron entry: it is
  // the same "user-configured send time, evaluate every few minutes" problem,
  // and it carries its own slot claim so a double tick cannot double-send.
  const callReport = await runDueCallReport()
    .catch(err => {
      console.error('[AutoReportCron] AI call report failed:', err instanceof Error ? err.message : err)
      return null
    })

  try {
    const result = await runDueSchedules()

    if (result.masterSwitchOff) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'auto reports paused', callReport })
    }

    if (result.fired.length) {
      console.log(`[AutoReportCron] fired ${result.fired.length} of ${result.checked} schedule(s)`)
    }

    return NextResponse.json({
      ok: true,
      checked: result.checked,
      fired: result.fired.length,
      outcomes: result.fired,
      callReport,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[AutoReportCron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
