/**
 * Cron endpoint — fires the daily AppleSystem confirmations auto-import.
 *
 * Imports *yesterday's* status-2 confirmations (create_date = yesterday). Used
 * on serverless (Vercel cron) where there is no always-on process; on the VM the
 * node-cron scheduler in `as-import-scheduler.ts` is the primary path. Both share
 * the SETTING_LAST_RUN_DATE dedup guard so they never double-fire.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAsImportSettings, startAsImport, SETTING_LAST_RUN_DATE } from '@/lib/as-import'

export const dynamic = 'force-dynamic'

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret && secret === cronSecret) return true
  return false
}

function todayInTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function yesterdayInTz(): string {
  const d = new Date(`${todayInTz()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized()

  const settings = await getAsImportSettings()
  if (!settings.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'auto-import disabled' })
  }

  const today = todayInTz()

  const lastRunRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRunRow?.value === today) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already ran today' })
  }

  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: today },
    create: { key: SETTING_LAST_RUN_DATE, value: today },
  })

  const yesterday = yesterdayInTz()
  const jobId = await startAsImport({ fromCreateDate: yesterday, toCreateDate: yesterday, mode: 'auto' })

  console.log(`[AsImportCron] started — create_date ${yesterday}, jobId ${jobId}`)
  return NextResponse.json({ ok: true, started: true, jobId, createDate: yesterday })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
