/**
 * Driver-Auto morning send — in-process node-cron, ticking at the top of every
 * hour. Each country is checked against its own local clock inside
 * `runScheduledBoardSends()`, so one hourly tick covers Colombo, Hanoi and
 * Singapore. The once-a-day guard is the UNIQUE index on `driver_board_sends`,
 * so this and `/api/cron/driver-auto-send` can both be on.
 *
 * Nothing is sent unless a country's `autoSend` switch is on (default OFF).
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { runScheduledBoardSends } from './notify'

let task: ScheduledTask | null = null

async function tick(reason: string) {
  try {
    const results = await runScheduledBoardSends()
    for (const r of results) {
      console.log(`[DriverAuto] ${reason} — ${r.country}: WA ${r.whatsappSent}, email ${r.emailSent}, skipped ${r.skipped}, failed ${r.failed}${r.reason ? ` (${r.reason})` : ''}`)
    }
  } catch (err) {
    console.error('[DriverAuto] scheduler tick error:', err instanceof Error ? err.message : err)
  }
}

export async function startDriverAutoScheduler(): Promise<void> {
  if (task) return
  task = cron.schedule('2 * * * *', () => { void tick('hourly tick') })
  console.log('[DriverAuto] morning open-trips scheduler armed (hourly, per-country local time)')
  // Boot catch-up: a restart inside the morning window still sends today.
  await tick('boot catch-up')
}
