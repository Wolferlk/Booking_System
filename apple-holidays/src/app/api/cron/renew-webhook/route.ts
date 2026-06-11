import { NextRequest, NextResponse } from 'next/server'
import { autoSubscribe } from '@/lib/mail-processor'

export const dynamic = 'force-dynamic'

// Called by Vercel Cron every 12 hours — renews the Graph webhook subscription
export async function GET(req: NextRequest) {
  // Verify Vercel cron secret to prevent unauthorized calls
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET ?? process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await autoSubscribe()
    return NextResponse.json({ ok: true, message: 'Webhook subscription ensured' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Cron] webhook renewal failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
