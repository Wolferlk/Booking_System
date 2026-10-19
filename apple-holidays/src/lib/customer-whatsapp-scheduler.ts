/**
 * Customer WhatsApp scheduler — pure Node backend, no OS cron, no GCP / Vercel cron.
 *
 * A node-cron tick every 5 minutes, started once at server boot from
 * instrumentation.ts (via cron-scheduler.ts):
 *   1. runDueCustomerDailyBriefings() — every booking is briefed once its own send
 *      time has passed in the guest's timezone. The time is a setting (WhatsApp
 *      Auto tab) with a per-booking override (Customer WhatsApp panel), so there
 *      is no single fire time to schedule — each tick evaluates due-ness itself.
 *   2. runCustomerFeedbackRequest() — once a day, after the default send time.
 *
 * Catch-up is built in: the first tick after a restart sends anything already due.
 * Per-trip-day dedupe inside the briefing sweep and the shared
 * customer_whatsapp_last_run_date guard for feedback mean nothing double-sends,
 * including alongside the HTTP routes.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import {
  runDueCustomerDailyBriefings,
  runCustomerFeedbackRequest,
  getDefaultBriefingTime,
} from './customer-whatsapp-automation'

// Timezone the feedback-request time is read in (the briefing uses each guest's own).
const TZ = process.env.CUSTOMER_MSG_TZ || 'Asia/Ho_Chi_Minh'

const SETTING_LAST_RUN_DATE = 'customer_whatsapp_last_run_date'

let task: ScheduledTask | null = null
let ticking = false

/** Today's date (YYYY-MM-DD) and minutes past midnight in the scheduler timezone. */
function nowInTz(): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  }
}

/** Departure-day feedback invite — once a day, after the default send time. */
async function maybeRunFeedback(): Promise<void> {
  const [h, m] = (await getDefaultBriefingTime()).split(':').map(Number)
  const now = nowInTz()
  if (now.minutes < h * 60 + m) return

  const lastRunRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRunRow?.value === now.date) return

  // Mark as run before starting so a restart can't double-fire
  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: now.date },
    create: { key: SETTING_LAST_RUN_DATE, value: now.date },
  })
  console.log(`[CustomerWhatsAppScheduler] feedback requests — firing for ${now.date} (tz ${TZ})`)
  await runCustomerFeedbackRequest()
}

async function tick(): Promise<void> {
  if (ticking) return   // a slow sweep must not overlap the next one
  ticking = true
  try {
    await runDueCustomerDailyBriefings().catch(err =>
      console.error('[CustomerWhatsAppScheduler] daily-briefing error:', err instanceof Error ? err.message : err))
    await maybeRunFeedback().catch(err =>
      console.error('[CustomerWhatsAppScheduler] feedback-request error:', err instanceof Error ? err.message : err))
  } finally {
    ticking = false
  }
}

/** Called once at server boot (instrumentation.ts → cron-scheduler). */
export async function startCustomerWhatsAppScheduler(): Promise<void> {
  try {
    if (task) return   // already started — idempotent
    task = cron.schedule('*/5 * * * *', () => { void tick() }, { timezone: TZ })
    console.log('[CustomerWhatsAppScheduler] scheduled every 5 min — briefings at each booking\'s send time')
    void tick()   // boot catch-up
  } catch (err) {
    console.error('[CustomerWhatsAppScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
