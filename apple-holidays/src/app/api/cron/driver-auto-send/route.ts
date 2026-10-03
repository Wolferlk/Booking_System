/**
 * Cron: Driver-Auto morning "open trips" links.
 *
 * Serverless counterpart to `lib/driver-auto/scheduler.ts`. Call hourly; each
 * country sends only inside its own morning window and only when its autoSend
 * switch is on. Double sends are impossible — see the UNIQUE index on
 * driver_board_sends.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runScheduledBoardSends } from '@/lib/driver-auto/notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get('secret') === secret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const results = await runScheduledBoardSends()
    return NextResponse.json({ ok: true, results: results.map(({ details: _d, ...r }) => r) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[DriverAutoCron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
