/**
 * Cron: AI feedback summary auto-send
 * Fires at 03:00 UTC daily (= 10:00 Vietnam / 08:30 Sri Lanka).
 * Finds bookings with departure 1–3 days ago and sends AI-written
 * feedback summaries to agents if not already sent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runAutoFeedbackSummaries } from '@/lib/send-feedback-summary'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[FeedbackSummaryCron] Starting auto-send run')

  try {
    const result = await runAutoFeedbackSummaries()
    console.log(`[FeedbackSummaryCron] Done — sent: ${result.sent}, skipped: ${result.skipped}, errors: ${result.errors}`)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[FeedbackSummaryCron] Fatal error:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
