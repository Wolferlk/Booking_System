/**
 * Aahaas B2C nightly import scheduler — pure Node backend.
 *
 * Fires just after midnight (default 00:30 Asia/Colombo) and imports the orders
 * placed *that day* whose travel is still upcoming, which is the "today's
 * bookings auto-fetch to ops overnight" behaviour the integration is specified
 * to have.
 *
 * Mirrors `as-import-scheduler.ts` exactly:
 *   - node-cron fires at the configured time with no drift.
 *   - explicit timezone, so "00:30" is half past midnight in Sri Lanka.
 *   - boot catch-up, so a VM that restarted after 00:30 still runs today.
 *   - reschedules live when the time changes in settings.
 *
 * The dedup guard (`SETTING_LAST_RUN_DATE`) is shared with the HTTP route
 * (/api/cron/b2c-import), so the always-on and serverless paths can both be
 * wired up without double-importing.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import {
  addDays,
  dateInTz,
  getB2cImportSettings,
  getLastRunDate,
  runB2cImport,
  setLastRunDate,
} from './b2c-import'

// Same timezone knob as the other daily jobs.
const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

let task: ScheduledTask | null = null
let currentExpr = ''

function todayInTz(): string {
  return dateInTz(new Date(), TZ)
}

/** Current { hour, minute } in the scheduler timezone. */
function nowHourMinuteInTz(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? '0'),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? '0'),
  }
}

/**
 * Run the import once for today if it has not run yet.
 * Returns true when it started the job, false when skipped.
 */
async function fireOnce(reason: string): Promise<boolean> {
  const settings = await getB2cImportSettings()
  if (!settings.enabled) {
    console.log(`[B2cImportScheduler] ${reason} — skipped (auto-import disabled)`)
    return false
  }

  const today = todayInTz()
  if ((await getLastRunDate()) === today) {
    console.log(`[B2cImportScheduler] ${reason} — skipped (already ran ${today})`)
    return false
  }

  // Claim the day before starting the work, so a restart mid-run cannot double-fire.
  await setLastRunDate(today)

  // Fires just after midnight, so the orders to pick up are the ones placed on
  // the day that has just ended (plus anything already booked today).
  const bookedFrom = addDays(today, -1)
  console.log(`[B2cImportScheduler] ${reason} — importing Aahaas orders booked since ${bookedFrom} (tz ${TZ})`)

  void runB2cImport({ mode: 'nightly', bookedFrom, trigger: 'scheduler' })
    .then((s) => {
      console.log(
        `[B2cImportScheduler] done — ${s.created.length} created, ` +
        `${s.alreadyImported.length} already present, ${s.skipped.length} skipped, ` +
        `${s.conflicts.length} conflicts, ${s.failed.length} failed`,
      )
      if (s.skipped.length > 0) {
        for (const sk of s.skipped) {
          console.log(`[B2cImportScheduler]   skip order ${sk.orderId}: ${sk.reason} — ${sk.detail}`)
        }
      }
    })
    .catch((err) => {
      console.error('[B2cImportScheduler] background job error:', err instanceof Error ? err.message : err)
    })

  return true
}

/**
 * (Re)schedule the node-cron task from current settings. Safe to call
 * repeatedly — it tears down the previous task first.
 */
export async function rescheduleB2cImportScheduler(): Promise<void> {
  const settings = await getB2cImportSettings()
  const expr = `${settings.minute} ${settings.hour} * * *`

  if (task && expr === currentExpr) return
  if (task) {
    task.stop()
    task = null
  }

  currentExpr = expr
  task = cron.schedule(expr, () => { void fireOnce('scheduled tick') }, { timezone: TZ })

  const hh = String(settings.hour).padStart(2, '0')
  const mm = String(settings.minute).padStart(2, '0')
  console.log(`[B2cImportScheduler] scheduled "${expr}" (${hh}:${mm} ${TZ}), enabled=${settings.enabled}`)
}

/**
 * Called once at server boot. Schedules the nightly job, then catches up if
 * today's run time has already passed and the job has not run yet.
 */
export async function startB2cImportScheduler(): Promise<void> {
  try {
    await rescheduleB2cImportScheduler()

    const settings = await getB2cImportSettings()
    if (settings.enabled) {
      const { hour, minute } = nowHourMinuteInTz()
      const past = hour > settings.hour || (hour === settings.hour && minute >= settings.minute)
      if (past) await fireOnce('boot catch-up')
    }
  } catch (err) {
    console.error('[B2cImportScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
