/**
 * Cron entry for the end-of-trip experience reports.
 *
 * Runs the post-departure sweep: one report per finished trip, mailed to the
 * agent when the trip went well and escalated instead when it did not. Its own
 * endpoint rather than a rider on `/api/cron/auto-reports`, because a sweep
 * that writes AI narratives for a day's worth of trips can run for minutes and
 * should not delay the daily ops mail.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 * Once a day is the right cadence — the sweep is idempotent, so a missed tick
 * is picked up by the next one anywhere inside the look-back window.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runSweep } from '@/lib/te/experience-report/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get('secret') === secret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runSweep({ actor: 'cron' })
    if (result.built) {
      console.log(`[ExperienceReportCron] built ${result.built}, sent ${result.sent}, held ${result.held}`)
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ExperienceReportCron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
