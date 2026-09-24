/**
 * Cron endpoint — one Checklist VN 2.1v sync (Excel → OPS mirror).
 *
 * Fired every 2 hours by the hosting cron (see vercel.json). On self-hosted
 * deployments the in-process scheduler does the same job; the run lock makes
 * it harmless if both fire. A run that started under 30 minutes ago is not
 * repeated, and an unchanged file is detected by its eTag without downloading.
 *
 * Auth: the shared CRON_SECRET bearer, or ?secret= for manual pings, matching
 * the other cron routes in this folder. `?force=1` re-reads an unchanged file.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSheetConfig, runSheetSync } from '@/lib/vn-checklist-sheet/sync'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  const secret = req.nextUrl.searchParams.get('secret')
  return Boolean(secret && cronSecret && secret === cronSecret)
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const force = req.nextUrl.searchParams.get('force') === '1'
    const config = await getSheetConfig()
    if (!config.enabled && !force) return NextResponse.json({ ok: true, skipped: 'disabled' })

    if (!force) {
      const recent = await prisma.vnSheetSync.findFirst({
        where: { startedAt: { gt: new Date(Date.now() - 30 * 60_000) }, status: { not: 'FAILED' } },
        select: { id: true },
      })
      if (recent) return NextResponse.json({ ok: true, skipped: 'ran in the last 30 minutes' })
    }

    const res = await runSheetSync({ trigger: 'CRON', force })
    if (!res) return NextResponse.json({ ok: true, skipped: 'another sync is running' })
    return NextResponse.json({ ok: res.status !== 'FAILED', ...res }, { status: res.status === 'FAILED' ? 502 : 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ChecklistVN 2.1 cron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
