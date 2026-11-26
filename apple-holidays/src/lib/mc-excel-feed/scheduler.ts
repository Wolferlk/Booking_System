/**
 * MC Excel Feed scheduler — in-process, for long-lived servers.
 *
 * Ticks every minute and asks isFeedDue(), so the on/off switch and the
 * interval are runtime settings. Ships OFF: until an admin switches the feed
 * on in Settings, every tick is one settings read and nothing else.
 * On serverless hosts /api/cron/mc-excel-feed is the same job over HTTP.
 */
import { isFeedDue } from './config'
import { runFeedSync } from './sync'

const TICK_MS = 60_000
let timer: NodeJS.Timeout | null = null
let busy = false

async function tick(): Promise<void> {
  if (busy) return
  busy = true
  try {
    if (!await isFeedDue()) return
    const r = await runFeedSync({ trigger: 'CRON' })
    if (r.run.status === 'FAILED') console.error(`[MC Excel Feed] sync failed: ${r.run.error}`)
  } catch (err) {
    console.error('[MC Excel Feed] tick failed:', err instanceof Error ? err.message : err)
  } finally {
    busy = false
  }
}

export function startMcExcelFeedScheduler(): void {
  if (timer) return
  // Start after the other workbook jobs' first runs so they don't all hit Graph together.
  setTimeout(() => { void tick() }, 9 * 60_000)
  timer = setInterval(() => { void tick() }, TICK_MS)
  console.log('[MC Excel Feed] Scheduler armed — OPS movements → Excel (switch: Settings → MC Excel Feed)')
}
