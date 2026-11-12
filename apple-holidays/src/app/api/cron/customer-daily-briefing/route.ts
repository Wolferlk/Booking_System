/**
 * Cron: Customer WhatsApp daily briefing
 * Call every 5–15 minutes. Each booking is briefed once its own send time (the
 * WhatsApp Auto default, or the booking's override) has passed in the guest's
 * timezone; already-briefed days are skipped, so frequent calls are safe.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runDueCustomerDailyBriefings } from '@/lib/customer-whatsapp-automation'
import { runDueTicketSends } from '@/lib/ticket-sends'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // Uses its own secret (CRON_SECRET_2) so customer messaging can be rotated
  // independently of the driver/mail cron jobs. Falls back to CRON_SECRET.
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET_2 || process.env.CRON_SECRET
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runDueCustomerDailyBriefings()
  // The daily ticket WhatsApp rides on this route: it runs once a day from
  // 14:30 Colombo and every other call is a cheap skip — no extra cron needed.
  const tickets = await runDueTicketSends().catch((err) => ({
    ran: false, reason: err instanceof Error ? err.message : String(err), bookings: 0, tickets: 0, errors: [],
  }))
  return NextResponse.json({ ok: true, ...result, tickets })
}
