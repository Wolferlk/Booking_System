/**
 * Cron endpoint — one Excel → Agenda auto-update sweep (Excel-built VN charts only).
 * Skips when switched off or not due, so pinging it often is harmless.
 * Auth: the shared CRON_SECRET bearer, or ?secret=.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isMcAutoDue, runMcAutoUpdate } from '@/lib/vn-mc-import/auto'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  const secret = req.nextUrl.searchParams.get('secret')
  return Boolean(secret && cronSecret && secret === cronSecret)
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    if (!await isMcAutoDue()) return NextResponse.json({ ok: true, skipped: 'switched off or not due yet' })
    const res = await runMcAutoUpdate({ trigger: 'CRON' })
    if (!res) return NextResponse.json({ ok: true, skipped: 'switched off, or another run is in progress' })
    const { results, ...summary } = res
    return NextResponse.json({ ok: res.status !== 'FAILED', ...summary, results: results.length }, { status: res.status === 'FAILED' ? 502 : 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Excel auto-update cron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
