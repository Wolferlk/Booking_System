/**
 * Cron endpoint — resolves the "30sundays Aahaas" placeholder file handler into
 * the real name from apple_quote_ai.
 *
 * Used on serverless (Vercel/Amplify cron) where there is no always-on process;
 * on the VM the in-process scheduler in `file-handler-resolve-scheduler.ts` is
 * the primary path. The sweep only touches bookings that still hold the
 * placeholder, so the two can run side by side without conflicting.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runFileHandlerAutoSweep } from '@/lib/file-handler-resolve'

export const dynamic = 'force-dynamic'

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

  try {
    const summary = await runFileHandlerAutoSweep('cron-http')
    return NextResponse.json({ ok: true, summary })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Sweep failed' },
      { status: 500 },
    )
  }
}

export const POST = GET
