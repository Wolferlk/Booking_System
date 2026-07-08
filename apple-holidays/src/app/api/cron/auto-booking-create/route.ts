/**
 * Cron endpoint — fires the daily OneDrive auto-booking-create job.
 *
 * Call this once daily at the configured run time via GCP Cloud Scheduler
 * (or vercel.json cron). The schedule in your external scheduler must match
 * the hour/minute set in the Admin → OneDrive Bookings UI.
 *
 * Returns immediately with { ok: true, started: true, jobId } — the actual
 * scan runs in the background so GCP's 60-second gateway timeout is never hit.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  getAutoCreateSettings,
  runBookingCreateForDate,
  SETTING_LAST_RUN_DATE,
} from '@/lib/auto-booking-create'

export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  // Allow direct secret in query param as fallback (GCP Cloud Scheduler)
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret && secret === cronSecret) return true
  return false
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized()

  const settings = await getAutoCreateSettings()

  if (!settings.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'auto-create disabled' })
  }

  const today = new Date().toISOString().slice(0, 10)

  // Dedup: skip if already ran today (same guard as the in-process scheduler)
  const lastRunRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRunRow?.value === today) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already ran today' })
  }

  // Mark as triggered before starting the background work
  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: today },
    create: { key: SETTING_LAST_RUN_DATE, value: today },
  })

  // Calculate target date using the configured daysAhead setting
  const targetDate = new Date()
  targetDate.setDate(targetDate.getDate() + settings.daysAhead)
  targetDate.setHours(0, 0, 0, 0)

  const triggeredBy = 'auto:cron-http'

  // Create job record first so the response carries the jobId
  const job = await prisma.oneDriveBookingJob.create({
    data: { targetDate, triggeredBy, status: 'running' },
  })

  // Fire in background — do NOT await so GCP's 60-second gateway timeout is never hit
  void runBookingCreateForDate(targetDate, triggeredBy, undefined, job.id).catch(err => {
    console.error('[AutoBookingCron] background job error:', err instanceof Error ? err.message : err)
  })

  console.log(`[AutoBookingCron] started — target: ${targetDate.toISOString().slice(0, 10)}, jobId: ${job.id}`)
  return NextResponse.json({ ok: true, started: true, jobId: job.id, targetDate: targetDate.toISOString().slice(0, 10) })
}

// Also accept POST (GCP Cloud Scheduler can send POST)
export async function POST(req: NextRequest) {
  return GET(req)
}
