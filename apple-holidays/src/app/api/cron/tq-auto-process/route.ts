import { NextRequest, NextResponse } from 'next/server'
import { runTqAutoProcess } from '@/lib/tq-auto-scheduler'

// Vercel HTTP entry for the NEW TQ auto-processor. On self-hosted servers the
// node-cron scheduler in tq-auto-scheduler.ts drives this instead; on Vercel this
// route is fired by the */5 cron in vercel.json. Both call the same run function,
// which is guarded against overlap and shares dedup keys, so no mail is processed
// twice.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET ?? process.env.WEBHOOK_SECRET
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runTqAutoProcess('vercel-cron')
  return NextResponse.json(result)
}
