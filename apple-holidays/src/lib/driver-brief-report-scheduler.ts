/**
 * Driver Brief readiness report scheduler — in-process node-cron, no OS cron.
 *
 * Mirrors `driver-log-scheduler.ts` exactly, for the same reasons: node-cron
 * fires precisely at the hour rather than drifting, an explicit timezone means
 * "07:00" is 7am in Colombo and not UTC, and a boot catch-up covers the VM
 * restarting after the send hour so a morning is never silently skipped.
 *
 * The once-a-day guard is NOT here — it lives inside `runDriverBriefReport()`,
 * so this scheduler and the `/api/cron/driver-brief-report` route can both be
 * enabled without any risk of the desk being mailed the same report twice.
 *
 * Started once at server boot from instrumentation.ts → cron-scheduler.ts.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { runDriverBriefReport } from '@/lib/driver-brief-report'
import type { OperationCountry } from '@prisma/client'

const TZ = process.env.DRIVER_BRIEF_REPORT_TZ || 'Asia/Colombo'
const SEND_HOUR = Number(process.env.DRIVER_BRIEF_REPORT_HOUR ?? '7')
const SEND_MINUTE = Number(process.env.DRIVER_BRIEF_REPORT_MINUTE ?? '0')
/** 'ALL' widens the report past Sri Lanka; anything else is one country. */
const COUNTRY = (process.env.DRIVER_BRIEF_REPORT_COUNTRY || 'SRILANKA').toUpperCase()

let task: ScheduledTask | null = null

function nowHourMinuteInTz(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  return {
    hour:   Number(parts.find(p => p.type === 'hour')?.value ?? '0'),
    minute: Number(parts.find(p => p.type === 'minute')?.value ?? '0'),
  }
}

async function fireOnce(reason: string): Promise<void> {
  try {
    const result = await runDriverBriefReport({
      country: COUNTRY === 'ALL' ? null : (COUNTRY as OperationCountry),
    })
    if (result.sent) {
      console.log(`[DriverBriefReport] ${reason} — sent (${result.files} files, ${result.readyToBrief} to brief)`)
    } else {
      console.log(`[DriverBriefReport] ${reason} — not sent: ${result.reason}`)
    }
  } catch (err) {
    console.error('[DriverBriefReport] send error:', err instanceof Error ? err.message : err)
  }
}

export async function startDriverBriefReportScheduler(): Promise<void> {
  try {
    if (task) return   // idempotent

    const expr = `${SEND_MINUTE} ${SEND_HOUR} * * *`
    task = cron.schedule(expr, () => { void fireOnce('scheduled tick') }, { timezone: TZ })
    console.log(`[DriverBriefReport] scheduled "${expr}" (${String(SEND_HOUR).padStart(2, '0')}:${String(SEND_MINUTE).padStart(2, '0')} ${TZ}, ${COUNTRY})`)

    const { hour, minute } = nowHourMinuteInTz()
    if (hour > SEND_HOUR || (hour === SEND_HOUR && minute >= SEND_MINUTE)) {
      await fireOnce('boot catch-up')
    }
  } catch (err) {
    console.error('[DriverBriefReport] start error:', err instanceof Error ? err.message : err)
  }
}
