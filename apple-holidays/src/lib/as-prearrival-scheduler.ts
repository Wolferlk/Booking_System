/**
 * Pre-arrival auto-sync scheduler — pure Node backend.
 *
 * Fires {@link firePreSyncOnce} daily at the time configured in the New AS
 * Booking → Pre-Arrival Sync tab (default 05:30 Asia/Colombo), from inside the
 * always-on Node process started at boot by `instrumentation.ts`. It therefore
 * does not depend on anyone having the app open.
 *
 * Mirrors `as-import-scheduler.ts` exactly:
 *   - node-cron fires at the scheduled time (no interval drift),
 *   - explicit timezone so "05:30" is morning in Sri Lanka,
 *   - boot catch-up when the VM restarted after the scheduled time,
 *   - reschedules live when the time is changed in the UI.
 *
 * The once-a-day guard lives in the DB and is shared with the HTTP cron route
 * (/api/cron/as-prearrival-sync), so the two can coexist without double-firing.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import {
  getPreSyncSettings,
  firePreSyncOnce,
  nowHourMinuteInTz,
  TZ,
} from './as-prearrival-sync'

let task: ScheduledTask | null = null
let currentExpr = ''

/**
 * (Re)schedule the daily task from the current DB settings. Safe to call
 * repeatedly — it tears down the previous task first.
 */
export async function reschedulePreArrivalSync(): Promise<void> {
  const settings = await getPreSyncSettings()
  const expr = `${settings.minute} ${settings.hour} * * *`

  if (task && expr === currentExpr) return

  if (task) {
    task.stop()
    task = null
  }

  currentExpr = expr
  task = cron.schedule(expr, () => { void firePreSyncOnce('scheduled tick') }, { timezone: TZ })

  console.log(
    `[PreArrivalSyncScheduler] scheduled "${expr}" ` +
    `(${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')} ${TZ}), ` +
    `enabled=${settings.enabled}, T−${settings.daysBefore}`,
  )
}

/**
 * Called once at server boot. Schedules the daily job and catches up if the
 * scheduled time already passed today and the job has not run yet.
 */
export async function startPreArrivalSyncScheduler(): Promise<void> {
  try {
    await reschedulePreArrivalSync()

    const settings = await getPreSyncSettings()
    if (settings.enabled) {
      const { hour, minute } = nowHourMinuteInTz()
      const past = hour > settings.hour || (hour === settings.hour && minute >= settings.minute)
      if (past) await firePreSyncOnce('boot catch-up')
    }
  } catch (err) {
    console.error('[PreArrivalSyncScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
