/**
 * Cron endpoint — one VN Driver Sync sweep (Movement Chart Google Sheet → movement drivers).
 * Skips when not due, so pinging it more often is harmless. `?force=1` runs it anyway.
 * Auth: the shared CRON_SECRET bearer, or ?secret=.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isDriverSyncDue, runDriverSync, isMissingTable } from '@/lib/vn-driver-sync/server'

export const dynamic     = 'force-dynamic'
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
    const force = req.nextUrl.searchParams.get('force') === '1'
    if (!force && !await isDriverSyncDue()) return NextResponse.json({ ok: true, skipped: 'not due yet' })
    const res = await runDriverSync({ trigger: 'CRON' })
    if (!res) return NextResponse.json({ ok: true, skipped: 'switched off, or another sweep is running' })
    const { changes, ...summary } = res
    return NextResponse.json({ ok: res.status !== 'FAILED', ...summary, changes: changes.length }, { status: res.status === 'FAILED' ? 502 : 200 })
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: 'Tables missing — run prisma/sql/apply-vn-driver-sync.sh' }, { status: 503 })
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[VN Driver Sync cron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
