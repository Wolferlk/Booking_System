/**
 * Cron endpoint — fills EMPTY airport meeting times on upcoming charts once the
 * booking's flights are known (lib/agenda-flight-time-sync.ts).
 *
 * For serverless hosting with no always-on process. On the VM the in-process
 * 5-minute sweep (lib/agenda-flight-time-scheduler.ts) plus the flight-write
 * hook are the primary path; running both is harmless (compare-and-set writes).
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runAgendaFlightTimeSweep } from '@/lib/agenda-flight-time-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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
    const summary = await runAgendaFlightTimeSweep('cron-http')
    return NextResponse.json({ ok: true, summary })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Sweep failed' },
      { status: 500 },
    )
  }
}

export const POST = GET
