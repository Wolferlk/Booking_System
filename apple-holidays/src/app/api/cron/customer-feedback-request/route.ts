/**
 * Cron: Post-departure feedback-form invite
 * Fires daily at 11:00 UTC = 18:00 local (default UTC+7 offset,
 * configurable via CUSTOMER_MSG_TZ_OFFSET_HOURS).
 * Sends a WhatsApp message with a signed link to the public guest feedback
 * form to every booking departing today. Triggered by Vercel cron or GCP
 * Cloud Scheduler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runCustomerFeedbackRequest } from '@/lib/customer-whatsapp-automation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Uses its own secret (CRON_SECRET_2) so customer messaging can be rotated
  // independently of the driver/mail cron jobs. Falls back to CRON_SECRET.
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET_2 || process.env.CRON_SECRET
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runCustomerFeedbackRequest()
  return NextResponse.json({ ok: true, ...result })
}
