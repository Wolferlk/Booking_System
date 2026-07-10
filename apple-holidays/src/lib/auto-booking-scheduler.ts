/**
 * Auto-Booking-Create scheduler — pure Node backend, no OS cron, no GCP Cloud Scheduler.
 *
 * Uses node-cron to fire the daily OneDrive auto-booking-create job at the time
 * configured in Admin → OneDrive Bookings (default 04:00). It runs entirely inside
 * the always-on Node process (Compute Engine VM), so it does NOT depend on any user
 * having the app open — it is started once at server boot from instrumentation.ts.
 *
 * Why this replaces the old setInterval(60s) + exact-minute-match approach:
 *   1. node-cron fires precisely at the scheduled time (no drift / skipped-minute misses).
 *   2. An explicit timezone means "04:00" is 4am in AUTO_BOOKING_TZ, not 4am UTC.
 *   3. Catch-up on boot: if the VM restarted after the scheduled time and the job
 *      had not run yet today, it runs immediately on startup.
 *   4. Reschedules live when the time is changed in the UI (rescheduleAutoBookingScheduler).
 *
 * The DB dedup guard (SETTING_LAST_RUN_DATE) is shared with the HTTP route
 * (/api/cron/auto-booking-create), so the two can coexist without double-firing.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import {
  getAutoCreateSettings,
  runBookingCreateForDate,
  SETTING_LAST_RUN_DATE,
} from './auto-booking-create'

// Timezone the configured hour/minute is interpreted in. Override via env if the
// VM's local time differs from where "morning 4am" should land. Defaults to
// Sri Lanka time (Apple Holidays HQ). e.g. AUTO_BOOKING_TZ=Asia/Colombo
const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

let task: ScheduledTask | null = null
let currentExpr = ''

// ── Timezone-aware helpers ─────────────────────────────────────────────────────

/** Today's date (YYYY-MM-DD) evaluated in the scheduler timezone. */
function todayInTz(): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** Current { hour, minute } in the scheduler timezone. */
function nowHourMinuteInTz(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const hour   = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  return { hour, minute }
}

// ── Core fire logic (shared by scheduled tick + boot catch-up) ─────────────────

/**
 * Runs the job once for today if it hasn't run yet. Returns true if it started
 * the job, false if it was skipped (disabled / already ran).
 */
async function fireOnce(reason: string): Promise<boolean> {
  const settings = await getAutoCreateSettings()
  if (!settings.enabled) {
    console.log(`[AutoBookingScheduler] ${reason} — skipped (auto-create disabled)`)
    return false
  }

  const today = todayInTz()

  // Dedup: skip if already ran today (same guard as the HTTP cron route)
  const lastRunRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRunRow?.value === today) {
    console.log(`[AutoBookingScheduler] ${reason} — skipped (already ran ${today})`)
    return false
  }

  // Mark as run before starting the background work so a restart can't double-fire
  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: today },
    create: { key: SETTING_LAST_RUN_DATE, value: today },
  })

  const target = new Date()
  target.setDate(target.getDate() + settings.daysAhead)
  target.setHours(0, 0, 0, 0)

  console.log(`[AutoBookingScheduler] ${reason} — firing for target ${target.toISOString().slice(0, 10)} (tz ${TZ})`)

  // Fire in background so the cron tick returns immediately
  void runBookingCreateForDate(target, 'auto:node-cron').catch(err => {
    console.error('[AutoBookingScheduler] background job error:', err instanceof Error ? err.message : err)
  })
  return true
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * (Re)schedule the node-cron task from the current DB settings. Safe to call
 * repeatedly — it tears down the previous task first. Called on boot and whenever
 * the run time is changed in the UI.
 */
export async function rescheduleAutoBookingScheduler(): Promise<void> {
  const settings = await getAutoCreateSettings()
  const expr = `${settings.minute} ${settings.hour} * * *`

  // Nothing changed and a task already exists — leave it running
  if (task && expr === currentExpr) return

  if (task) {
    task.stop()
    task = null
  }

  currentExpr = expr
  task = cron.schedule(expr, () => { void fireOnce('scheduled tick') }, { timezone: TZ })

  console.log(`[AutoBookingScheduler] scheduled "${expr}" (${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')} ${TZ}), enabled=${settings.enabled}`)
}

/**
 * Called once at server boot (instrumentation.ts → cron-scheduler). Schedules the
 * daily job and performs a catch-up run if the scheduled time already passed today
 * and the job has not run yet (e.g. the VM was restarted after 04:00).
 */
export async function startAutoBookingScheduler(): Promise<void> {
  try {
    await rescheduleAutoBookingScheduler()

    // Boot catch-up: if we're already past the scheduled time today, run now.
    const settings = await getAutoCreateSettings()
    if (settings.enabled) {
      const { hour, minute } = nowHourMinuteInTz()
      const pastScheduledTime = hour > settings.hour || (hour === settings.hour && minute >= settings.minute)
      if (pastScheduledTime) {
        await fireOnce('boot catch-up')
      }
    }
  } catch (err) {
    console.error('[AutoBookingScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
