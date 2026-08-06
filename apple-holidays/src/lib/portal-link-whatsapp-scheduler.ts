/**
 * Trip-portal WhatsApp scheduler — pure Node backend (no OS cron, no Vercel cron).
 *
 * Fires both portal-link sweeps once a day at PORTAL_MSG_SEND_HOUR (default
 * 10:00) in PORTAL_MSG_TZ:
 *   1. runPortalWelcome()  — bookings created yesterday get the "follow your
 *                            booking on this link" template
 *   2. runPortalReminder() — bookings arriving in 3 days get the "ready to
 *                            travel? here are the latest details" template
 *
 * Mirrors customer-whatsapp-scheduler.ts: node-cron for a precise daily tick, an
 * explicit timezone, and a boot catch-up so a restart past the send hour doesn't
 * silently skip a day. The per-automation on/off switches and the per-booking
 * "already sent" dedupe live inside the run functions; the once-per-day guard
 * lives here and is shared with /api/cron/portal-link-whatsapp.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import { runPortalWelcome, runPortalReminder } from './portal-link-whatsapp'

const TZ          = process.env.PORTAL_MSG_TZ || process.env.CUSTOMER_MSG_TZ || 'Asia/Colombo'
const SEND_HOUR   = Number(process.env.PORTAL_MSG_SEND_HOUR   ?? '10')
const SEND_MINUTE = Number(process.env.PORTAL_MSG_SEND_MINUTE ?? '0')

export const SETTING_LAST_RUN_DATE = 'portal_link_whatsapp_last_run_date'

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

/**
 * Run both sweeps once for today if they haven't run yet. Returns true if it
 * started the work, false if skipped because today's run already happened.
 */
export async function firePortalLinkRun(reason: string): Promise<boolean> {
  const today = todayInTz()

  const lastRun = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRun?.value === today) {
    console.log(`[PortalLinkScheduler] ${reason} — skipped (already ran ${today})`)
    return false
  }

  // Mark before starting so a restart mid-run can't double-fire the whole batch.
  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: today },
    create: { key: SETTING_LAST_RUN_DATE, value: today },
  })

  console.log(`[PortalLinkScheduler] ${reason} — firing for ${today} (tz ${TZ})`)

  void runPortalWelcome().catch(err =>
    console.error('[PortalLinkScheduler] welcome error:', err instanceof Error ? err.message : err))
  void runPortalReminder().catch(err =>
    console.error('[PortalLinkScheduler] reminder error:', err instanceof Error ? err.message : err))

  return true
}

export async function startPortalLinkWhatsAppScheduler(): Promise<void> {
  try {
    if (task) return   // idempotent

    const expr = `${SEND_MINUTE} ${SEND_HOUR} * * *`
    task = cron.schedule(expr, () => { void firePortalLinkRun('scheduled tick') }, { timezone: TZ })
    console.log(`[PortalLinkScheduler] scheduled "${expr}" (${String(SEND_HOUR).padStart(2, '0')}:${String(SEND_MINUTE).padStart(2, '0')} ${TZ})`)

    const { hour, minute } = nowHourMinuteInTz()
    if (hour > SEND_HOUR || (hour === SEND_HOUR && minute >= SEND_MINUTE)) {
      await firePortalLinkRun('boot catch-up')
    }
  } catch (err) {
    console.error('[PortalLinkScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
