/**
 * Cron: Driver App reminders (new trip, tomorrow, today's plan, vehicle photos
 * due). Call hourly. Once-only per notification via mobile_notifications.dedupeKey.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runMobileReminders } from '@/lib/mobile/reminders'
import { isMobileTableMissing } from '@/lib/mobile/http'

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
    return NextResponse.json({ ok: true, ...(await runMobileReminders()) })
  } catch (err) {
    if (isMobileTableMissing(err)) return NextResponse.json({ ok: true, skipped: 'driver app tables not created yet' })
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[MobileNotifyCron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
