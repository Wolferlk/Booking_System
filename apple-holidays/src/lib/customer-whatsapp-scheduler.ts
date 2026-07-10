/**
 * Customer WhatsApp scheduler — pure Node backend, no OS cron, no GCP / Vercel cron.
 *
 * Uses node-cron to fire the daily customer-messaging job at CUSTOMER_MSG_SEND_HOUR
 * (default 18:00 = 6pm) in CUSTOMER_MSG_TZ. It runs entirely inside the always-on
 * Node process, so it does NOT depend on any user having the app open — it is started
 * once at server boot from instrumentation.ts (via cron-scheduler.ts).
 *
 * Each daily fire runs both automations against every eligible booking that has a
 * correctly-set WhatsApp/phone contact:
 *   1. runCustomerDailyBriefing()  — tomorrow's itinerary to guests mid-trip
 *   2. runCustomerFeedbackRequest() — departure-day feedback-form invite
 *
 * Why this replaces the old setInterval(60s) + exact-minute-match approach
 * (maybeRunCustomerMessaging):
 *   1. node-cron fires precisely at 18:00 (no drift / skipped-minute misses).
 *   2. An explicit timezone means "18:00" is 6pm in CUSTOMER_MSG_TZ, not 6pm UTC.
 *   3. Catch-up on boot: if the VM restarted after 18:00 and the job had not run
 *      yet today, it runs immediately on startup — a day is never silently skipped.
 *
 * The DB dedup guard (customer_whatsapp_last_run_date) is shared with the HTTP
 * routes (/api/cron/customer-daily-briefing, /api/cron/customer-feedback-request)
 * and the per-booking dedupe inside the run functions, so nothing double-sends.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import {
  runCustomerDailyBriefing,
  runCustomerFeedbackRequest,
} from './customer-whatsapp-automation'

// Timezone the send hour is interpreted in. Vietnam (UTC+7) by default, matching
// CUSTOMER_MSG_TZ_OFFSET_HOURS used inside customer-whatsapp-automation.ts.
const TZ = process.env.CUSTOMER_MSG_TZ || 'Asia/Ho_Chi_Minh'
const SEND_HOUR = Number(process.env.CUSTOMER_MSG_SEND_HOUR ?? '18')
const SEND_MINUTE = Number(process.env.CUSTOMER_MSG_SEND_MINUTE ?? '0')

const SETTING_LAST_RUN_DATE = 'customer_whatsapp_last_run_date'

let task: ScheduledTask | null = null

// ── Timezone-aware helpers ─────────────────────────────────────────────────────

/** Today's date (YYYY-MM-DD) evaluated in the scheduler timezone. */
function todayInTz(): string {
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
 * Runs both customer automations once for today if they haven't run yet. Returns
 * true if it started the work, false if skipped (already ran today).
 *
 * The per-automation on/off switches and per-booking "already sent today" dedupe
 * live inside the run functions, so we only guard the once-per-day trigger here.
 */
async function fireOnce(reason: string): Promise<boolean> {
  const today = todayInTz()

  const lastRunRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRunRow?.value === today) {
    console.log(`[CustomerWhatsAppScheduler] ${reason} — skipped (already ran ${today})`)
    return false
  }

  // Mark as run before starting the background work so a restart can't double-fire
  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: today },
    create: { key: SETTING_LAST_RUN_DATE, value: today },
  })

  console.log(`[CustomerWhatsAppScheduler] ${reason} — firing for ${today} (tz ${TZ})`)

  // Fire in background so the cron tick returns immediately
  void runCustomerDailyBriefing().catch(err =>
    console.error('[CustomerWhatsAppScheduler] daily-briefing error:', err instanceof Error ? err.message : err))
  void runCustomerFeedbackRequest().catch(err =>
    console.error('[CustomerWhatsAppScheduler] feedback-request error:', err instanceof Error ? err.message : err))

  return true
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Called once at server boot (instrumentation.ts → cron-scheduler). Schedules the
 * daily 6pm job and performs a catch-up run if 18:00 already passed today and the
 * job has not run yet (e.g. the VM was restarted after 6pm).
 */
export async function startCustomerWhatsAppScheduler(): Promise<void> {
  try {
    if (task) return   // already started — idempotent

    const expr = `${SEND_MINUTE} ${SEND_HOUR} * * *`
    task = cron.schedule(expr, () => { void fireOnce('scheduled tick') }, { timezone: TZ })

    console.log(`[CustomerWhatsAppScheduler] scheduled "${expr}" (${String(SEND_HOUR).padStart(2, '0')}:${String(SEND_MINUTE).padStart(2, '0')} ${TZ})`)

    // Boot catch-up: if we're already past the scheduled time today, run now.
    const { hour, minute } = nowHourMinuteInTz()
    const pastScheduledTime = hour > SEND_HOUR || (hour === SEND_HOUR && minute >= SEND_MINUTE)
    if (pastScheduledTime) {
      await fireOnce('boot catch-up')
    }
  } catch (err) {
    console.error('[CustomerWhatsAppScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
