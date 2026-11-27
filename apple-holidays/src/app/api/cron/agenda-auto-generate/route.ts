/**
 * Cron endpoint — builds movement charts for new bookings that have none yet.
 *
 * For serverless hosting with no always-on process. On the VM the in-process
 * scheduler (lib/agenda-auto-generate-scheduler.ts) is the primary path. Both
 * use the same per-booking claim, so they never build the same chart twice.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runAgendaAutoGenerateSweep } from '@/lib/agenda-auto-generate'

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
  try {
    const summary = await runAgendaAutoGenerateSweep('cron-http')
    return NextResponse.json({ ok: true, summary })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Sweep failed' },
      { status: 500 },
    )
  }
}

export const POST = GET
