/**
 * Aahaas B2C live watch scheduler — pure Node backend.
 *
 * Drives {@link runB2cWatch} every N minutes (default 5) so a new store order
 * lands in ops within minutes instead of at the 00:30 nightly run. Same
 * self-rescheduling `setTimeout` chain as `as-watch-scheduler.ts`: the interval
 * is re-read on every tick, and the delay is measured from the end of the
 * previous check so a slow one never stacks up.
 */
import { getB2cWatchSettings, runB2cWatch } from './b2c-watch'

let timer: ReturnType<typeof setTimeout> | null = null
let started = false

/** First check shortly after boot, once the server is warm. */
const BOOT_DELAY_MS = 60_000
/** Fallback delay when the settings read itself fails — retry, don't die. */
const ERROR_RETRY_MS = 5 * 60 * 1000

function arm(delayMs: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void tick() }, delayMs)
  // Never let the watcher hold the process open on its own.
  timer.unref?.()
}

async function tick(): Promise<void> {
  let nextMs = ERROR_RETRY_MS
  try {
    const settings = await getB2cWatchSettings()
    nextMs = settings.intervalMinutes * 60_000
    if (settings.enabled) await runB2cWatch({ trigger: 'scheduler', force: true })
  } catch (err) {
    console.error('[B2cWatchScheduler] tick error:', err instanceof Error ? err.message : err)
  } finally {
    arm(nextMs)
  }
}

/** Called once at server boot. */
export async function startB2cWatchScheduler(): Promise<void> {
  if (started) return
  started = true
  try {
    const settings = await getB2cWatchSettings()
    console.log(`[B2cWatchScheduler] started — every ${settings.intervalMinutes} min, enabled=${settings.enabled}`)
  } catch {
    console.log('[B2cWatchScheduler] started — settings unavailable, will read on first tick')
  }
  arm(BOOT_DELAY_MS)
}
