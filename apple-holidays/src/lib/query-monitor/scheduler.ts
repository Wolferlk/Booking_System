/**
 * Query Monitor scheduler — in-process, interval-driven.
 *
 * The sweep interval is a setting the team can change from the dashboard
 * (hourly by default, but they may want 30 min at peak season), so this ticks
 * every minute and decides whether a sweep is due rather than baking a cron
 * expression in at boot. Same approach as reports/report-scheduler.ts.
 *
 * On Vercel the process is not long-lived, so /api/cron/query-monitor is the
 * equivalent entry point and vercel.json fires it hourly.
 */
import { getConfig } from './config'
import { runQueryMonitorSweep } from './run'

const TICK_MS = 60_000

let timer: NodeJS.Timeout | null = null
let running = false

/** True when enough time has passed since the last completed sweep. */
async function isDue(): Promise<boolean> {
  const config = await getConfig()
  if (!config.enabled) return false
  if (!config.lastRunAt) return true

  const last = new Date(config.lastRunAt).getTime()
  if (!Number.isFinite(last)) return true

  return Date.now() - last >= config.intervalMinutes * 60_000
}

async function tick(): Promise<void> {
  if (running) return
  try {
    if (!await isDue()) return
    running = true
    const summary = await runQueryMonitorSweep({ trigger: 'CRON' })
    if (summary.status !== 'SKIPPED') {
      console.log(
        `[QueryMonitor] Scheduled sweep ${summary.status} — `
        + `${summary.entriesCreated} new, ${summary.rowsAppended} appended, ${summary.errors} error(s)`,
      )
    }
  } catch (err) {
    console.error('[QueryMonitor] Scheduled sweep crashed:', err instanceof Error ? err.message : err)
  } finally {
    running = false
  }
}

export function startQueryMonitorScheduler(): void {
  if (timer) return

  // Delayed first tick so the server finishes booting before any Graph traffic.
  setTimeout(() => { void tick() }, 90_000)
  timer = setInterval(() => { void tick() }, TICK_MS)

  console.log('[QueryMonitor] Scheduler started — checks every minute whether a sweep is due')
}

export function stopQueryMonitorScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
