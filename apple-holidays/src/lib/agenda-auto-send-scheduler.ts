/**
 * Tour-confirmation auto-email scheduler — pure Node backend (no OS cron).
 *
 * Fires the "email the agenda PDF to every customer arriving in 3 days" job at
 * AGENDA_AUTO_EMAIL_HOUR (default 09:00) in AGENDA_AUTO_EMAIL_TZ (default
 * Asia/Colombo). Mirrors driver-log-scheduler.ts: node-cron for a precise daily
 * tick, an explicit timezone, and a boot catch-up so a restart past the send
 * hour doesn't silently skip a day.
 *
 * Per-booking gating (global switch, missing email, already-sent dedupe) lives
 * in runAgendaAutoSend(); the once-per-day guard lives here.
 *
 * This is the only automatic trigger — there is no Vercel cron entry for it.
 * /api/cron/agenda-auto-send remains as a manual/on-demand trigger only.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import { runAgendaAutoSend } from '@/lib/agenda-auto-send'

const TZ          = process.env.AGENDA_AUTO_EMAIL_TZ || 'Asia/Colombo'
const SEND_HOUR   = Number(process.env.AGENDA_AUTO_EMAIL_HOUR   ?? '9')
const SEND_MINUTE = Number(process.env.AGENDA_AUTO_EMAIL_MINUTE ?? '0')

const SETTING_LAST_RUN_DATE = 'agenda_auto_email_last_run_date'

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

async function fireOnce(reason: string): Promise<boolean> {
  const today = todayInTz()

  const lastRun = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  if (lastRun?.value === today) {
    console.log(`[AgendaMailScheduler] ${reason} — skipped (already ran ${today})`)
    return false
  }

  // Mark before starting so a restart mid-run can't double-fire the whole batch.
  await prisma.systemSetting.upsert({
    where:  { key: SETTING_LAST_RUN_DATE },
    update: { value: today },
    create: { key: SETTING_LAST_RUN_DATE, value: today },
  })

  console.log(`[AgendaMailScheduler] ${reason} — firing for ${today} (tz ${TZ})`)
  void runAgendaAutoSend()
    .then(r => console.log(`[AgendaMailScheduler] arrivals ${r.date} — sent: ${r.sent}, skipped: ${r.skipped}, errors: ${r.errors.length}`))
    .catch(err => console.error('[AgendaMailScheduler] run error:', err instanceof Error ? err.message : err))
  return true
}

export async function startAgendaAutoSendScheduler(): Promise<void> {
  try {
    if (task) return   // idempotent

    const expr = `${SEND_MINUTE} ${SEND_HOUR} * * *`
    task = cron.schedule(expr, () => { void fireOnce('scheduled tick') }, { timezone: TZ })
    console.log(`[AgendaMailScheduler] scheduled "${expr}" (${String(SEND_HOUR).padStart(2, '0')}:${String(SEND_MINUTE).padStart(2, '0')} ${TZ})`)

    const { hour, minute } = nowHourMinuteInTz()
    if (hour > SEND_HOUR || (hour === SEND_HOUR && minute >= SEND_MINUTE)) {
      await fireOnce('boot catch-up')
    }
  } catch (err) {
    console.error('[AgendaMailScheduler] start error:', err instanceof Error ? err.message : err)
  }
}
