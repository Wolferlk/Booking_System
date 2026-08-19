/**
 * Live Confirmation Watch scheduler — pure Node backend.
 *
 * Drives {@link runAsWatch} on the interval configured in New AS Booking →
 * Live Watch. Started once at boot from `instrumentation.ts` → `cron-scheduler`,
 * so it runs with nobody's browser open.
 *
 * ── Why a self-rescheduling timer rather than node-cron ───────────────────────
 * The other daily jobs fire at a wall-clock time, which is exactly what cron
 * expresses well. This one fires at an *interval* the user picks freely, and
 * cron can only express a "every N" step for values that divide 60 — a 7- or 90-minute
 * setting would silently fire at the wrong times. A `setTimeout` chain that
 * re-reads the settings on every tick honours any interval exactly, and picks up
 * a changed interval on the following tick without a restart.
 *
 * Each tick is also self-correcting: the delay is measured from the *end* of the
 * previous run, so a slow check delays the next one instead of stacking up.
 */
import { getWatchSettings, runAsWatch } from './as-watch'

let timer: ReturnType<typeof setTimeout> | null = null
let started = false
/** Bumped on every (re)schedule so a timer armed by a superseded call is ignored. */
let generation = 0

/** First check runs shortly after boot, once the server is warm. */
const BOOT_DELAY_MS = 90_000
/** Fallback delay when the settings read itself fails — retry, don't die. */
const ERROR_RETRY_MS = 5 * 60 * 1000

function arm(delayMs: number, gen: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void tick(gen) }, delayMs)
  // Never let the watcher hold the process open on its own.
  timer.unref?.()
}

async function tick(gen: number): Promise<void> {
  if (gen !== generation) return   // superseded by a reschedule

  let nextMs = ERROR_RETRY_MS
  try {
    const settings = await getWatchSettings()
    nextMs = settings.intervalMinutes * 60_000

    if (settings.enabled) {
      const outcome = await runAsWatch({ trigger: 'auto' })
      if (!outcome.ran && outcome.reason === 'already-running') {
        console.log('[AsWatchScheduler] skipped — previous check still running')
      }
    }
  } catch (err) {
    console.error('[AsWatchScheduler] tick error:', err instanceof Error ? err.message : err)
  } finally {
    if (gen === generation) arm(nextMs, gen)
  }
}

/**
 * Re-arm the loop from current settings — called when the interval or the
 * enabled switch changes in the UI so the change takes effect immediately
 * rather than after the pending delay expires.
 */
export async function rescheduleAsWatch(): Promise<void> {
  if (!started) return
  const gen = ++generation
  try {
    const settings = await getWatchSettings()
    arm(settings.intervalMinutes * 60_000, gen)
    console.log(
      `[AsWatchScheduler] re-armed — every ${settings.intervalMinutes} min, enabled=${settings.enabled}`,
    )
  } catch (err) {
    console.error('[AsWatchScheduler] reschedule failed:', err instanceof Error ? err.message : err)
    arm(ERROR_RETRY_MS, gen)
  }
}

/** Called once at server boot. */
export async function startAsWatchScheduler(): Promise<void> {
  if (started) return
  started = true
  const gen = ++generation
  try {
    const settings = await getWatchSettings()
    console.log(
      `[AsWatchScheduler] started — every ${settings.intervalMinutes} min ` +
      `(${settings.lookbackDays}-day create-date window), enabled=${settings.enabled}`,
    )
  } catch {
    console.log('[AsWatchScheduler] started — settings unavailable, will read on first tick')
  }
  arm(BOOT_DELAY_MS, gen)
}
