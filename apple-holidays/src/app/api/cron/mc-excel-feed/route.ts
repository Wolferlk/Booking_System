/**
 * Cron endpoint — one MC Excel Feed sync (OPS movements → Excel).
 *
 * For serverless hosts; self-hosted servers run the in-process scheduler and
 * the run lock makes it harmless if both fire. Does nothing while the feed is
 * switched off in Settings or the interval has not passed (`?force=1` skips
 * the interval, never the off switch).
 *
 * Auth: the shared CRON_SECRET bearer, or ?secret=, like the other cron routes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getFeedConfig, isFeedDue } from '@/lib/mc-excel-feed/config'
import { runFeedSync } from '@/lib/mc-excel-feed/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  const secret = req.nextUrl.searchParams.get('secret')
  return Boolean(secret && cronSecret && secret === cronSecret)
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const config = await getFeedConfig()
  if (!config.enabled) return NextResponse.json({ ok: true, skipped: 'switched off' })
  if (req.nextUrl.searchParams.get('force') !== '1' && !await isFeedDue()) return NextResponse.json({ ok: true, skipped: 'not due' })
  const r = await runFeedSync({ trigger: 'CRON' })
  return NextResponse.json({ ok: r.run.status !== 'FAILED', status: r.run.status, counts: r.run.counts, error: r.run.error })
}

export const GET = handle
export const POST = handle
