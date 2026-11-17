/**
 * Excel → Agenda auto-update scheduler — in-process, for long-lived servers.
 *
 * Ticks every minute and asks isMcAutoDue(), so the interval (15 min by
 * default) and the OFF / AUTO switch are runtime settings. Ships OFF: until an
 * admin switches it on, every tick is one settings read and nothing else.
 * On serverless hosts /api/cron/vn-mc-auto is the same job over HTTP.
 */
import { isMcAutoDue, runMcAutoUpdate } from './auto'

const TICK_MS = 60_000
let timer: NodeJS.Timeout | null = null
let busy = false

async function tick(): Promise<void> {
  if (busy) return
  busy = true
  try {
    if (!await isMcAutoDue()) return
    const res = await runMcAutoUpdate({ trigger: 'CRON' })
    if (res && (res.changedBookings || res.status === 'FAILED')) {
      console.log(`[Excel auto-update] ${res.status} — ${res.bookings} Excel-built charts checked, ${res.changedBookings} changed `
        + `(${res.fields} fields, +${res.created} movements)${res.error ? ` — ${res.error}` : ''}`)
    }
  } catch (err) {
    console.error('[Excel auto-update] tick failed:', err instanceof Error ? err.message : err)
  } finally {
    busy = false
  }
}

export function startMcAutoScheduler(): void {
  if (timer) return
  // Start a little after the Driver Sync's first run so the two don't download the workbook together.
  setTimeout(() => { void tick() }, 7 * 60_000)
  timer = setInterval(() => { void tick() }, TICK_MS)
  console.log('[Excel auto-update] Scheduler armed — Excel-built VN charts follow the Movement Chart Excel (switch: vn_mc_auto_mode)')
}
