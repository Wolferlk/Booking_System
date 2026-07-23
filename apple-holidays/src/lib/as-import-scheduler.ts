/**
 * AppleSystem confirmations auto-import scheduler — pure Node backend.
 *
 * Fires the daily confirmations import at the time configured in the New AS
 * Booking → Daily Auto-Import tab (default 06:00). It runs entirely inside the
 * always-on Node process (started once at boot from instrumentation.ts →
 * cron-scheduler), so it does NOT depend on any user having the app open.
 *
 * On fire it imports *yesterday's* status-2 confirmations (create_date =
 * yesterday) via {@link runAsImport}. Mirrors `auto-booking-scheduler.ts`:
 *   - node-cron fires precisely at the scheduled time (no drift).
 *   - explicit timezone (Asia/Colombo) so "06:00" is morning in Sri Lanka.
 *   - boot catch-up: if the VM restarted after 06:00 and today's run hasn't
 *     happened yet, it runs immediately on startup.
 *   - reschedules live when the time is changed in the UI.
 *
 * The DB dedup guard (SETTING_LAST_RUN_DATE) is shared with the HTTP route
 * (/api/cron/as-auto-import), so the two can coexist without double-firing.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import {
  getAsImportSettings,
  runAsImport,
  SETTING_LAST_RUN_DATE,
} from './as-import'

// Reuse the same timezone knob as the OneDrive auto-booking scheduler.
const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

let task: ScheduledTask | null = null
let currentExpr = ''

// ── Timezone-aware helpers ─────────────────────────────────────────────────────

/** Today's date (YYYY-MM-DD) evaluated in the scheduler timezone. */
function todayInTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** Yesterday's date (YYYY-MM-DD) in the scheduler timezone. */
function yesterdayInTz(): string {
  const today = todayInTz()
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Current { hour, minute } in the scheduler timezone. */
function nowHourMinuteInTz(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const hour   = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return { hour, minute }
}

// ── Core fire logic (shared by scheduled tick + boot catch-up) ─────────────────

/**
 * Runs the import once for today if it hasn't run yet. Returns true if it
 * started the job, false if it was skipped (disabled / already ran).
 */
async function fireOnce(reason: string): Promise<boolean> {
  const settings = await getAsImportSettings()
  if (!settings.enabled) {
    console.log(`[AsImportScheduler] ${reason} — skipped (auto-import disabled)`)
    return false
  }

  const today = todayInTz()

  // Dedup: skip if already ran today (same guard as the HTTP cron route)
  const lastRunRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRunRow?.value === today) {
    console.log(`[AsImportScheduler] ${reason} — skipped (already ran ${today})`)
    return false
  }

  // Mark as run before starting the background work so a restart can't double-fire
  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: today },
    create: { key: SETTING_LAST_RUN_DATE, value: today },
  })

  const yesterday = yesterdayInTz()
  console.log(`[AsImportScheduler] ${reason} — importing confirmations created ${yesterday} (tz ${TZ})`)

  // Fire in background so the cron tick returns immediately.
  void runAsImport({ fromCreateDate: yesterday, toCreateDate: yesterday, mode: 'auto' }).catch((err) => {
    console.error('[AsImportScheduler] background job error:', err instanceof Error ? err.message : err)
  })
  return true
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * (Re)schedule the node-cron task from the current DB settings. Safe to call
 * repeatedly — it tears down the previous task first. Called on boot and
 * whenever the run time is changed in the UI.
 */
export async function rescheduleAsImportScheduler(): Promise<void> {
  const settings = await getAsImportSettings()
  const expr = `${settings.minute} ${settings.hour} * * *`

  if (task && expr === currentExpr) return

  if (task) {
    task.stop()
    task = null
  }

  currentExpr = expr
  task = cron.schedule(expr, () => { void fireOnce('scheduled tick') }, { timezone: TZ })

  console.log(`[AsImportScheduler] scheduled "${expr}" (${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')} ${TZ}), enabled=${settings.enabled}`)
}

/**
 * Called once at server boot. Schedules the daily job and performs a catch-up
 * run if the scheduled time already passed today and the job has not run yet.
 */
export async function startAsImportScheduler(): Promise<void> {
  try {
    await rescheduleAsImportScheduler()

    const settings = await getAsImportSettings()
    if (settings.enabled) {
      const { hour, minute } = nowHourMinuteInTz()
      const pastScheduledTime = hour > settings.hour || (hour === settings.hour && minute >= settings.minute)
      if (pastScheduledTime) {
        await fireOnce('boot catch-up')
      }
    }
  } catch (err) {
    console.error('[AsImportScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
