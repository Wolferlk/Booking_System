/**
 * Upcoming Arrivals update check — daily scheduler (pure Node backend).
 *
 * Fires {@link fireUpSyncOnce} at the time set in New AS Booking → Upcoming
 * Updates (default 04:30 Asia/Colombo — ahead of the 05:30 pre-arrival sync and
 * the 06:00 import, so the book is current before the working day). Mirrors
 * `as-prearrival-scheduler.ts`: node-cron with an explicit timezone, a boot
 * catch-up when the VM restarted after the scheduled time, and a live
 * reschedule when the time is changed in the UI.
 *
 * The once-a-day guard and the run lock live in the DB and are shared with the
 * HTTP cron route (/api/cron/as-upcoming-sync), so the two never double-fire.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { getUpSyncSettings, fireUpSyncOnce, nowHourMinuteInTz, TZ } from './as-upcoming-sync'

let task: ScheduledTask | null = null
let currentExpr = ''

export async function rescheduleUpcomingSync(): Promise<void> {
  const settings = await getUpSyncSettings()
  const expr = `${settings.minute} ${settings.hour} * * *`
  if (task && expr === currentExpr) return

  if (task) {
    task.stop()
    task = null
  }
  currentExpr = expr
  task = cron.schedule(expr, () => { void fireUpSyncOnce('scheduled tick') }, { timezone: TZ })

  console.log(
    `[UpcomingSyncScheduler] scheduled "${expr}" ` +
    `(${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')} ${TZ}), ` +
    `enabled=${settings.enabled}, autoApply=${settings.autoApply}, horizon=${settings.horizonDays}d`,
  )
}

/** Called once at server boot. */
export async function startUpcomingSyncScheduler(): Promise<void> {
  try {
    await rescheduleUpcomingSync()
    const settings = await getUpSyncSettings()
    if (settings.enabled) {
      const { hour, minute } = nowHourMinuteInTz()
      const past = hour > settings.hour || (hour === settings.hour && minute >= settings.minute)
      if (past) await fireUpSyncOnce('boot catch-up')
    }
  } catch (err) {
    console.error('[UpcomingSyncScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
