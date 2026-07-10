/**
 * Driver Log auto-send scheduler — pure Node backend, no OS cron, no Vercel cron.
 *
 * Uses node-cron to fire the "send tomorrow's Driver Advance Sheets" job at
 * DRIVER_LOG_SEND_HOUR (default 18:00 = 6pm the day before) in DRIVER_LOG_TZ
 * (default Asia/Colombo). It runs entirely inside the always-on Node process,
 * so it works on the hosted backend even when no user has the app open. Started
 * once at server boot from instrumentation.ts → cron-scheduler.ts.
 *
 * Mirrors customer-whatsapp-scheduler.ts:
 *   • node-cron fires precisely at the hour (no drift / skipped-minute misses),
 *   • an explicit timezone means "18:00" is 6pm in DRIVER_LOG_TZ, not UTC,
 *   • boot catch-up: if the VM restarted after the send hour and the job has not
 *     run today, it runs immediately so a day is never silently skipped.
 *
 * The actual per-booking gating (global switch, opt-out, already-sent dedupe)
 * lives in runDriverLogAutoSend(); the once-per-day guard lives here.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import { runDriverLogAutoSend } from '@/lib/driver-log-notify'
import { SETTING_LAST_RUN_DATE } from '@/lib/driver-log'

const TZ = process.env.DRIVER_LOG_TZ || 'Asia/Colombo'
const SEND_HOUR   = Number(process.env.DRIVER_LOG_SEND_HOUR ?? '18')
const SEND_MINUTE = Number(process.env.DRIVER_LOG_SEND_MINUTE ?? '0')

let task: ScheduledTask | null = null

function todayInTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function nowHourMinuteInTz(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  return {
    hour:   Number(parts.find(p => p.type === 'hour')?.value ?? '0'),
    minute: Number(parts.find(p => p.type === 'minute')?.value ?? '0'),
  }
}

/** Runs the auto-send once for today if it hasn't run yet. */
async function fireOnce(reason: string): Promise<boolean> {
  const today = todayInTz()

  const lastRun = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRun?.value === today) {
    console.log(`[DriverLogScheduler] ${reason} — skipped (already ran ${today})`)
    return false
  }

  // Mark before starting so a restart mid-run can't double-fire the whole batch.
  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: today },
    create: { key: SETTING_LAST_RUN_DATE, value: today },
  })

  console.log(`[DriverLogScheduler] ${reason} — firing for ${today} (tz ${TZ})`)
  void runDriverLogAutoSend().catch(err =>
    console.error('[DriverLogScheduler] auto-send error:', err instanceof Error ? err.message : err))
  return true
}

/**
 * Called once at server boot. Schedules the daily send job and performs a
 * catch-up run if the send hour already passed today and it has not run yet.
 */
export async function startDriverLogScheduler(): Promise<void> {
  try {
    if (task) return   // idempotent

    const expr = `${SEND_MINUTE} ${SEND_HOUR} * * *`
    task = cron.schedule(expr, () => { void fireOnce('scheduled tick') }, { timezone: TZ })
    console.log(`[DriverLogScheduler] scheduled "${expr}" (${String(SEND_HOUR).padStart(2, '0')}:${String(SEND_MINUTE).padStart(2, '0')} ${TZ})`)

    const { hour, minute } = nowHourMinuteInTz()
    const pastSendTime = hour > SEND_HOUR || (hour === SEND_HOUR && minute >= SEND_MINUTE)
    if (pastSendTime) {
      await fireOnce('boot catch-up')
    }
  } catch (err) {
    console.error('[DriverLogScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
