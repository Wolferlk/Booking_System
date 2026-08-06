/**
 * Cron endpoint — one Booking Team Query Monitor sweep.
 *
 * Fired hourly by Vercel cron (see vercel.json). On self-hosted deployments the
 * in-process scheduler in query-monitor/scheduler.ts does the same job, and the
 * run lock means it is harmless if both are active.
 *
 * Auth: the shared CRON_SECRET bearer that Vercel sends, or ?secret= for manual
 * pings, matching the other cron routes in this folder.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runQueryMonitorSweep } from '@/lib/query-monitor/run'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true

  const secret = req.headers.get('x-query-monitor-secret') ?? req.nextUrl.searchParams.get('secret')
  if (secret && (secret === process.env.QUERY_MONITOR_SECRET || secret === cronSecret)) return true

  return false
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runQueryMonitorSweep({ trigger: 'CRON' })
    return NextResponse.json({ ok: true, ...summary, steps: undefined })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[QueryMonitor cron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
