/**
 * Cron: WhatsApp booking group automation. Serverless counterpart to the tick in
 * customer-whatsapp-scheduler.ts. Call every 5 minutes; every send is claimed by
 * a unique key, so frequent or overlapping calls cannot double-message a guest.
 *
 * Secured by CRON_SECRET_2 or CRON_SECRET (Authorization: Bearer <secret>).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runGroupAutomations } from '@/lib/wa-groups/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET_2 || process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, ...(await runGroupAutomations()) })
}
