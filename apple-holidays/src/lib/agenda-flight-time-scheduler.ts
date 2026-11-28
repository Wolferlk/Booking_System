/**
 * Safety sweep for the late-flight meeting-time fill (agenda-flight-time-sync.ts).
 *
 * Flight writes made through this process are caught at once by the Prisma
 * hook. This 5-minute tick catches the rest: writes from another server
 * process, raw SQL, or a hook run that failed. Each booking is rechecked at
 * most every 30 minutes, at most 20 per tick, so rows still waiting for a
 * flight do not cost a query every tick.
 *
 * Re-arms from the end of each run (same as the agenda auto-generate
 * scheduler). Off: AGENDA_FLIGHT_TIME_SYNC=off, or switch "Fill empty airport
 * times" off on Settings → Airport Pickup Timings.
 */
import { runAgendaFlightTimeSweep } from './agenda-flight-time-sync'

const TICK_MS = 5 * 60_000

let timer: NodeJS.Timeout | null = null
let started = false

function arm(delayMs: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void tick() }, delayMs)
  timer.unref?.()
}

async function tick(): Promise<void> {
  try {
    const r = await runAgendaFlightTimeSweep('sweep')
    if (r.filled) console.log(`[AgendaFlightTimeSweep] filled ${r.filled} meeting time(s) on ${r.refs.join(', ')} (${r.checked} checked)`)
  } catch (err) {
    console.error('[AgendaFlightTimeSweep] tick error:', err instanceof Error ? err.message : err)
  } finally {
    arm(TICK_MS)
  }
}

export function startAgendaFlightTimeScheduler(): void {
  if (started || process.env.AGENDA_FLIGHT_TIME_SYNC === 'off') return
  started = true
  arm(90_000)
  console.log('[AgendaFlightTimeSweep] started — every 5 min fills empty airport meeting times once flights are known; switch: Settings → Airport Pickup Timings')
}
