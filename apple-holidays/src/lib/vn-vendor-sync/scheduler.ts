/**
 * VN Vendor Sync scheduler — in-process, for long-lived servers.
 *
 * Ticks every minute and asks isVendorSyncDue(), so the interval (15 min by
 * default) is a runtime setting rather than a cron expression baked in at
 * boot. Where the process is not long-lived (Amplify / Lambda),
 * /api/cron/vn-vendor-sync is the same job over HTTP, and kickIfDue() on every
 * panel read is the backstop. The run lock makes it harmless if two fire.
 */
import { isVendorSyncDue, runVendorSync } from './server'

const TICK_MS = 60_000
let timer: NodeJS.Timeout | null = null
let busy = false

async function tick(): Promise<void> {
  if (busy) return
  busy = true
  try {
    if (!await isVendorSyncDue()) return
    const res = await runVendorSync({ trigger: 'CRON' })
    if (res) {
      console.log(`[VN Vendor Sync] ${res.status} — ${res.bookings} bookings, ${res.applied} applied, ${res.updated} updated, `
        + `${res.suggested} to review, ${res.keptManual} kept manual${res.error ? ` — ${res.error}` : ''}`)
    }
  } catch (err) {
    // Tables not created yet, or the DB is unreachable — try again next tick.
    const msg = err instanceof Error ? err.message : String(err)
    if (!/doesn't exist|does not exist|P2021/i.test(msg)) console.error('[VN Vendor Sync] tick failed:', msg)
  } finally {
    busy = false
  }
}

export function startVnVendorSyncScheduler(): void {
  if (timer) return
  // Let the server finish booting (and the Excel mirror its first read) first.
  setTimeout(() => { void tick() }, 4 * 60_000)
  timer = setInterval(() => { void tick() }, TICK_MS)
  console.log('[VN Vendor Sync] Scheduler started — tour vendors from the Excel checklist, every 15 minutes (a setting)')
}
