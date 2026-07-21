/**
 * Cron: automatic tour-confirmation email.
 * Fires daily and emails the agenda PDF to every customer arriving in 3 days.
 * Triggered by Vercel cron or GCP Cloud Scheduler.
 *
 * `?dryRun=1` lists what would be sent without emailing anyone.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runAgendaAutoSend } from '@/lib/agenda-auto-send'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET_2 || process.env.CRON_SECRET
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const result = await runAgendaAutoSend({ dryRun })
  return NextResponse.json({ ok: true, dryRun, ...result })
}
