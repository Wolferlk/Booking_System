/**
 * Cron endpoint — one Live Confirmation Watch cycle.
 *
 * The in-process scheduler (`as-watch-scheduler.ts`) is the primary path on a
 * long-lived server. On serverless, where no process survives between requests,
 * point an external scheduler at this route instead — call it as often as the
 * shortest interval you want; the watch's own interval setting is still honoured,
 * so a call that arrives too soon after the last check is skipped rather than
 * running early. `?force=1` overrides that for an ad-hoc sweep.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWatchSettings, runAsWatch, WATCH_LAST_AT } from '@/lib/as-watch'

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
  const settings = await getWatchSettings()
  if (!settings.enabled && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'watch disabled' })
  }

  // Honour the configured interval even when called more frequently.
  if (!force) {
    const last = await prisma.systemSetting.findUnique({ where: { key: WATCH_LAST_AT } })
    const lastMs = last?.value ? Date.parse(last.value) : NaN
    if (Number.isFinite(lastMs) && Date.now() - lastMs < settings.intervalMinutes * 60_000) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'interval not elapsed' })
    }
  }

  const outcome = await runAsWatch({ trigger: 'auto', force })
  return outcome.ran
    ? NextResponse.json({ ok: true, check: outcome.check })
    : NextResponse.json({ ok: true, skipped: true, reason: outcome.reason })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
