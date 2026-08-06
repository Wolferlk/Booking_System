/**
 * Cron: WhatsApp the customer trip-portal link.
 *   • welcome  — bookings created WHATSAPP_PORTAL_WELCOME_DAYS_AFTER days ago
 *   • reminder — bookings arriving in WHATSAPP_PORTAL_REMINDER_DAYS_BEFORE days
 *
 * The in-process node-cron scheduler (portal-link-whatsapp-scheduler.ts) is the
 * primary trigger; this route stays as an external/manual fallback.
 *
 * `?stage=welcome|reminder` runs only one sweep (default: both).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runPortalWelcome, runPortalReminder } from '@/lib/portal-link-whatsapp'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET_2 || process.env.CRON_SECRET
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stage = req.nextUrl.searchParams.get('stage')

  const results = []
  if (stage !== 'reminder') results.push(await runPortalWelcome())
  if (stage !== 'welcome')  results.push(await runPortalReminder())

  return NextResponse.json({ ok: true, results })
}
