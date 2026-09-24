/**
 * Checklist VN 2.1v scheduler — in-process, interval-driven.
 *
 * The interval is a setting (2 hours by default), so this ticks every 5
 * minutes and asks isSyncDue() rather than baking a cron expression in at boot.
 * Same approach as query-monitor/scheduler.ts.
 *
 * Where the process is not long-lived, /api/cron/vn-checklist-sheet is the same
 * job over HTTP, and refreshIfStale() on every read is the backstop: the first
 * person to open a stale checklist starts the sync.
 */
import { isSyncDue, runSheetSync } from './sync'

const TICK_MS = 5 * 60_000

let timer: NodeJS.Timeout | null = null
let running = false

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    if (!await isSyncDue()) return
    const res = await runSheetSync({ trigger: 'CRON' })
    if (res) {
      console.log(
        `[ChecklistVN 2.1] Scheduled sync ${res.status} — ${res.tours} tours, `
        + `${res.added} new, ${res.changed} changed, ${res.removed} removed${res.error ? ` — ${res.error}` : ''}`,
      )
    }
  } catch (err) {
    // Tables not created yet, or the DB is unreachable — try again next tick.
    const msg = err instanceof Error ? err.message : String(err)
    if (!/doesn't exist|does not exist|P2021/i.test(msg)) console.error('[ChecklistVN 2.1] tick failed:', msg)
  } finally {
    running = false
  }
}

export function startVnChecklistSheetScheduler(): void {
  if (timer) return
  // Delayed first tick so the server finishes booting before any Graph traffic.
  setTimeout(() => { void tick() }, 3 * 60_000)
  timer = setInterval(() => { void tick() }, TICK_MS)
  console.log('[ChecklistVN 2.1] Scheduler started — checks every 5 minutes whether a sync is due')
}
