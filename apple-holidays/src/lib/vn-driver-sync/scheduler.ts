/**
 * VN Driver Sync scheduler — in-process, for long-lived servers.
 *
 * Ticks every minute and asks isDriverSyncDue(), so the interval (15 min by
 * default) is a runtime setting. On Amplify / Lambda, /api/cron/vn-driver-sync
 * is the same job over HTTP and kickIfDue() on every page read is the backstop.
 * The run lock makes it harmless if two fire.
 */
import { isDriverSyncDue, runDriverSync } from './server'

const TICK_MS = 60_000
let timer: NodeJS.Timeout | null = null
let busy = false

async function tick(): Promise<void> {
  if (busy) return
  busy = true
  try {
    if (!await isDriverSyncDue()) return
    const res = await runDriverSync({ trigger: 'CRON' })
    if (res) {
      console.log(`[VN Driver Sync] ${res.status} — ${res.sheetRows} sheet rows, ${res.bookings} bookings, ${res.applied} applied, `
        + `${res.updated} updated, ${res.suggested} to review, ${res.keptManual} kept, ${res.aiCalls} AI${res.error ? ` — ${res.error}` : ''}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/doesn't exist|does not exist|P2021/i.test(msg)) console.error('[VN Driver Sync] tick failed:', msg)
  } finally {
    busy = false
  }
}

export function startVnDriverSyncScheduler(): void {
  if (timer) return
  setTimeout(() => { void tick() }, 5 * 60_000)
  timer = setInterval(() => { void tick() }, TICK_MS)
  console.log('[VN Driver Sync] Scheduler started — drivers from the VN Movement Chart Google Sheet, every 15 minutes (a setting)')
}
