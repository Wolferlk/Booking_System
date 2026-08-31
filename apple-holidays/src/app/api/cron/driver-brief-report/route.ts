/**
 * Cron: the D-3 → D-1 driver brief readiness report.
 *
 * The serverless counterpart to `driver-brief-report-scheduler.ts` — either may
 * fire it, and neither can double-send because the once-a-day guard is claimed
 * inside `runDriverBriefReport()` before the mail is built.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runDriverBriefReport } from '@/lib/driver-brief-report'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get('secret') === secret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('country')
  const country = raw === 'ALL' ? null : ((raw as OperationCountry) || ('SRILANKA' as OperationCountry))

  try {
    const result = await runDriverBriefReport({ country })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[DriverBriefReportCron] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
