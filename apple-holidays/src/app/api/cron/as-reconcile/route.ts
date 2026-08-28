/**
 * Cron endpoint — one AppleSystem reconciliation cycle.
 *
 * The in-process scheduler (`as-reconcile-scheduler.ts`) is the primary path on
 * a long-lived server. On serverless, where no process survives between
 * requests, point an external scheduler at this route instead — call it as often
 * as the shortest interval you want; the configured interval is still honoured,
 * so a call that arrives too soon after the last run is skipped rather than
 * running early. `?force=1` overrides that for an ad-hoc reconciliation.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getReconcileSettings, runAsReconcile, RECONCILE_LAST_AT } from '@/lib/as-reconcile'

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
  const settings = await getReconcileSettings()
  if (!settings.enabled && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'reconciliation disabled' })
  }

  // Honour the configured interval even when called more frequently.
  if (!force) {
    const last = await prisma.systemSetting.findUnique({ where: { key: RECONCILE_LAST_AT } })
    const lastMs = last?.value ? Date.parse(last.value) : NaN
    if (Number.isFinite(lastMs) && Date.now() - lastMs < settings.intervalMinutes * 60_000) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'interval not elapsed' })
    }
  }

  const outcome = await runAsReconcile({ trigger: 'auto', force })
  return outcome.ran
    ? NextResponse.json({ ok: true, run: outcome.run })
    : NextResponse.json({ ok: true, skipped: true, reason: outcome.reason })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
