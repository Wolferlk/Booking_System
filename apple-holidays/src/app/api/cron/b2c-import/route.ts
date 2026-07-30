/**
 * Cron endpoint — fires the nightly Aahaas B2C order import.
 *
 * Imports the orders booked *today* (in AUTO_BOOKING_TZ) whose travel is still
 * upcoming. Used on serverless (Vercel/Amplify cron) where there is no always-on
 * process; on the VM the node-cron scheduler in `b2c-import-scheduler.ts` is the
 * primary path. Both share the SETTING_LAST_RUN_DATE guard so they never
 * double-import.
 *
 * `?mode=backfill` sweeps every upcoming order instead of just today's, for the
 * initial load. Backfill deliberately bypasses the once-a-day guard, since it is
 * an operator action rather than the scheduled tick.
 *
 * Secured by CRON_SECRET (Authorization: Bearer <secret>, or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  addDays,
  dateInTz,
  getB2cImportSettings,
  getLastRunDate,
  runB2cImport,
  setLastRunDate,
} from '@/lib/b2c-import'

export const dynamic = 'force-dynamic'

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  if (req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  return req.nextUrl.searchParams.get('secret') === cronSecret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const backfill = req.nextUrl.searchParams.get('mode') === 'backfill'
  const today = dateInTz(new Date(), TZ)

  if (backfill) {
    const summary = await runB2cImport({ mode: 'backfill', trigger: 'cron-http' })
    console.log(`[B2cImportCron] backfill — ${summary.created.length} created of ${summary.candidates} candidates`)
    return NextResponse.json({ ok: true, started: true, summary })
  }

  const settings = await getB2cImportSettings()
  if (!settings.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'auto-import disabled' })
  }

  if ((await getLastRunDate()) === today) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already ran today' })
  }

  // Claim the day before the work starts so a retry cannot double-import.
  await setLastRunDate(today)

  const summary = await runB2cImport({ mode: 'nightly', bookedFrom: addDays(today, -1), trigger: 'cron-http' })
  console.log(
    `[B2cImportCron] ${today} — ${summary.created.length} created, ` +
    `${summary.skipped.length} skipped, ${summary.conflicts.length} conflicts, ${summary.failed.length} failed`,
  )
  return NextResponse.json({ ok: true, started: true, summary })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
