/**
 * Cron: Customer WhatsApp daily briefing
 * Call every 5–15 minutes. Each booking is briefed once its own send time (the
 * WhatsApp Auto default, or the booking's override) has passed in the guest's
 * timezone; already-briefed days are skipped, so frequent calls are safe.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runDueCustomerDailyBriefings } from '@/lib/customer-whatsapp-automation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Uses its own secret (CRON_SECRET_2) so customer messaging can be rotated
  // independently of the driver/mail cron jobs. Falls back to CRON_SECRET.
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET_2 || process.env.CRON_SECRET
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runDueCustomerDailyBriefings()
  return NextResponse.json({ ok: true, ...result })
}
