/**
 * Cron endpoint — one Aahaas B2C live-watch check.
 *
 * The in-process timer (`b2c-watch-scheduler.ts`) is the primary path on a
 * long-lived server. On serverless, point an external scheduler at this route
 * every few minutes instead. Calls closer than a minute apart are skipped;
 * `?force=1` overrides that for an ad-hoc sweep.
 *
 * INSERT-only into ops; the Aahaas store is only ever read.
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runB2cWatch } from '@/lib/b2c-watch'

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

  const outcome = await runB2cWatch({
    trigger: 'cron-http',
    force: req.nextUrl.searchParams.get('force') === '1',
  })
  if (!outcome.ran) return NextResponse.json({ ok: true, skipped: true, reason: outcome.reason })
  const s = outcome.summary
  return NextResponse.json({
    ok: true,
    created: s.created,
    conflicts: s.conflicts,
    failed: s.failed,
    skipped: s.skipped.length,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
