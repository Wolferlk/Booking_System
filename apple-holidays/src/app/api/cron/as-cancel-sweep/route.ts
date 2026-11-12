/**
 * Cron endpoint — the daily AppleSystem cancellation check.
 *
 * On a long-lived server the in-process ticker (`startCancelSweepScheduler`)
 * runs it. On Amplify, where nothing survives between requests, point an
 * external scheduler at this route — hourly is fine: it runs at most once a day,
 * from the configured hour, and every other call is a cheap skip.
 * `?force=1` runs it now regardless of the hour or of today's stamp.
 *
 * Never cancels a booking: it moves AppleSystem-cancelled bookings to
 * "requested to cancel" (PENDING_CANCELLATION) for accounts to approve.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runDailyIfDue } from '@/lib/as-cancel-sweep'

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
  const force = req.nextUrl.searchParams.get('force') === '1'
  const out = await runDailyIfDue('cron', force)
  if (!out.ran) return NextResponse.json({ ok: true, skipped: true, reason: out.reason })

  const s = out.run!.summary
  return NextResponse.json({
    ok: !out.run!.error,
    window: { from: out.run!.from, to: out.run!.to },
    upstreamCancelled: s.upstream,
    matched: s.matched,
    requested: s.requested,
    superseded: s.superseded ?? 0,
    awaiting: s.awaiting,
    skipped: s.skipped,
    failed: s.failed,
    refs: s.refs,
    error: out.run!.error ?? null,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
